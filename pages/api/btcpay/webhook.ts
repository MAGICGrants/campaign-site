import { NextApiRequest, NextApiResponse } from 'next'
import getRawBody from 'raw-body'
import crypto from 'crypto'
import dayjs from 'dayjs'

import {
  BtcPayGetRatesRes,
  BtcPayGetPaymentMethodsRes,
  DonationMetadata,
  DonationCryptoPayments,
} from '../../../server/types'
import { btcpayApi as _btcpayApi, btcpayApi, prisma } from '../../../server/services'
import { env } from '../../../env.mjs'
import { givePointsToUser } from '../../../server/utils/perks'
import { sendDonationConfirmationEmail } from '../../../server/utils/mailing'
import { NET_DONATION_AMOUNT_WITH_POINTS_RATE, POINTS_PER_USD } from '../../../config'
import { getDonationAttestation, getMembershipAttestation } from '../../../server/utils/attestation'
import { addUserToPgMembersGroup } from '../../../utils/pg-forum-connection'
import { log } from '../../../utils/logging'
import {
  getBtcPayInvoice,
  getBtcPayInvoicePaymentMethods,
} from '../../../server/utils/btcpayserver'

export const config = {
  api: {
    bodyParser: false,
  },
}

type WebhookBody = Record<string, any> & {
  manuallyMarked: boolean
  deliveryId: string
  webhookId: string
  originalDeliveryId: string
  isRedelivery: boolean
  type: string
  timestamp: number
  storeId: string
  invoiceId: string
  metadata?: DonationMetadata
  paymentMethodId: string
  payment: {
    id: string
    value: string
  }
}

async function handleFundingRequiredApiDonation(body: WebhookBody, res: NextApiResponse) {
  if (!body.metadata || JSON.stringify(body.metadata) === '{}') return
  // If none of these are set, this donation didn't come from a campaign site user
  if (!body.metadata.projectSlug || !body.metadata.fundSlug) return

  const existingDonationsForInvoice = await prisma.donation.findMany({
    where: { btcPayInvoiceId: body.invoiceId },
  })

  const txId = body.payment.id

  if (existingDonationsForInvoice.length > 0) {
    // Check if this txid has already been processed
    const txIdAlreadyProcessed = existingDonationsForInvoice.find((donation) => (donation.cryptoPayments as DonationCryptoPayments)?.find((payment) => payment.txId === txId))

    if (txIdAlreadyProcessed) {
      log(
        'warn',
        `[BTCPay webhook] Attempted to process already processed txid ${txId} for funding API invoice ${body.invoiceId}.`
      )
      return
    }
  }

  // Handle payment methods like "BTC-LightningNetwork" if added in the future
  const cryptoCode = body.paymentMethodId.includes('-')
    ? body.paymentMethodId.split('-')[0]
    : body.paymentMethodId

  const { data: rates } = await btcpayApi.get<BtcPayGetRatesRes>(
    `/rates?currencyPair=${cryptoCode}_USD`
  )

  const cryptoRate = Number(rates[0].rate)
  const cryptoAmount = Number(body.payment.value)
  const fiatAmount = Number((cryptoAmount * cryptoRate).toFixed(2))

  const cryptoPayments: DonationCryptoPayments = []

  cryptoPayments.push({
    cryptoCode,
    grossAmount: cryptoAmount,
    netAmount: cryptoAmount,
    rate: cryptoRate,
    txId,
  })

  await prisma.donation.create({
    data: {
      userId: null,
      btcPayInvoiceId: body.invoiceId,
      projectName: body.metadata.projectName,
      projectSlug: body.metadata.projectSlug,
      fundSlug: body.metadata.fundSlug,
      grossFiatAmount: fiatAmount,
      netFiatAmount: fiatAmount,
      cryptoPayments,
      showDonorNameOnLeaderboard: body.metadata.showDonorNameOnLeaderboard === 'true',
      donorName: body.metadata.donorName,
    },
  })

  try {
    const fundSlug = body.metadata.fundSlug
    const projectSlug = body.metadata.projectSlug
    await Promise.all([
      res.revalidate('/'),
      res.revalidate(`/${fundSlug}/projects`),
      res.revalidate(`/${fundSlug}`),
      res.revalidate(`/${fundSlug}/projects/${projectSlug}`),
    ])
  } catch (err) {
    log('warn', `[BTCPay webhook] Failed to revalidate pages for invoice ${body.invoiceId}.`)
  }

  log('info', `[BTCPay webhook] Successfully processed invoice ${body.invoiceId}!`)
}

// This handles both donations and memberships.
async function handleDonationOrMembership(body: WebhookBody, res: NextApiResponse) {
  if (!body.metadata || JSON.stringify(body.metadata) === '{}') return
  // If none of these are set, this donation didn't come from a campaign site user
  if (!body.metadata.projectSlug || !body.metadata.fundSlug) return

  const existingDonation = await prisma.donation.findFirst({
    where: { btcPayInvoiceId: body.invoiceId },
  })

  if (existingDonation) {
    log(
      'warn',
      `[BTCPay webhook] Attempted to process already processed invoice ${body.invoiceId}.`
    )
    return
  }

  const termToMembershipExpiresAt = {
    monthly: dayjs().add(1, 'month').toDate(),
    annually: dayjs().add(1, 'year').toDate(),
  } as const

  let membershipExpiresAt = null

  if (body.metadata.isMembership === 'true' && body.metadata.membershipTerm) {
    membershipExpiresAt = termToMembershipExpiresAt[body.metadata.membershipTerm]
  }

  const cryptoPayments: DonationCryptoPayments = []
  const paymentMethods = await getBtcPayInvoicePaymentMethods(body.invoiceId)
  const shouldGivePointsBack = body.metadata.givePointsBack === 'true'

  // Get how much was paid for each crypto
  paymentMethods.forEach((paymentMethod) => {
    if (!body.metadata) return

    const cryptoRate = Number(paymentMethod.rate)
    const grossCryptoAmount = Number(paymentMethod.paymentMethodPaid)

    // Deduct 10% of amount if donator wants points
    const netCryptoAmount = shouldGivePointsBack
      ? grossCryptoAmount * NET_DONATION_AMOUNT_WITH_POINTS_RATE
      : grossCryptoAmount

    // Move on if amound paid with current method is 0
    if (!grossCryptoAmount) return

    cryptoPayments.push({
      cryptoCode: paymentMethod.currency,
      grossAmount: grossCryptoAmount,
      netAmount: netCryptoAmount,
      rate: cryptoRate,
    })
  })

  // Handle marked paid invoice
  if (body.manuallyMarked) {
    const invoice = await getBtcPayInvoice(body.invoiceId)

    const amountPaidFiat = cryptoPayments.reduce(
      (total, paymentMethod) => total + paymentMethod.grossAmount * paymentMethod.rate,
      0
    )

    const invoiceAmountFiat = Number(invoice.amount)
    const amountDueFiat = invoiceAmountFiat - amountPaidFiat

    if (amountDueFiat > 0) {
      cryptoPayments.push({
        cryptoCode: 'MANUAL',
        grossAmount: amountDueFiat,
        netAmount: shouldGivePointsBack
          ? amountDueFiat * NET_DONATION_AMOUNT_WITH_POINTS_RATE
          : amountDueFiat,
        rate: 1,
      })
    }
  }

  const grossFiatAmount = cryptoPayments.reduce(
    (total, paymentMethod) => total + paymentMethod.grossAmount * paymentMethod.rate,
    0
  )

  const netFiatAmount = cryptoPayments.reduce(
    (total, paymentMethod) => total + paymentMethod.netAmount * paymentMethod.rate,
    0
  )

  const pointsToGive = shouldGivePointsBack ? Math.floor(grossFiatAmount / POINTS_PER_USD) : 0

  const donation = await prisma.donation.create({
    data: {
      userId: body.metadata.userId,
      btcPayInvoiceId: body.invoiceId,
      projectName: body.metadata.projectName,
      projectSlug: body.metadata.projectSlug,
      fundSlug: body.metadata.fundSlug,
      cryptoPayments,
      grossFiatAmount: Number(grossFiatAmount.toFixed(2)),
      netFiatAmount: Number(netFiatAmount.toFixed(2)),
      pointsAdded: pointsToGive,
      membershipExpiresAt,
      membershipTerm: body.metadata.membershipTerm || null,
      showDonorNameOnLeaderboard: body.metadata.showDonorNameOnLeaderboard === 'true',
      donorName: body.metadata.donorName,
      donorNameIsProfane: body.metadata.donorNameIsProfane === 'true',
    },
  })

  // Add points
  if (shouldGivePointsBack && body.metadata.userId) {
    try {
      await givePointsToUser({ pointsToGive, donation })
    } catch (error) {
      log(
        'error',
        `[BTCPay webhook] Failed to give points for invoice ${body.invoiceId}. Rolling back.`
      )
      await prisma.donation.delete({ where: { id: donation.id } })
      throw error
    }
  }

  // Add PG forum user to membership group
  if (
    body.metadata.isMembership &&
    body.metadata.fundSlug === 'privacyguides' &&
    body.metadata.userId
  ) {
    try {
      await addUserToPgMembersGroup(body.metadata.userId)
    } catch (error) {
      log(
        'warn',
        `[BTCPay webhook] Could not add user ${body.metadata.userId} to PG forum members group. Invoice: ${body.invoiceId}. NOT rolling back. Continuing... Cause:`
      )
      console.error(error)
    }
  }

  if (body.metadata.donorEmail && body.metadata.donorName) {
    let attestationMessage = ''
    let attestationSignature = ''

    if (body.metadata.isMembership === 'true' && body.metadata.membershipTerm) {
      const attestation = await getMembershipAttestation({
        donorName: body.metadata.donorName,
        donorEmail: body.metadata.donorEmail,
        totalAmountToDate: grossFiatAmount,
        donation,
      })

      attestationMessage = attestation.message
      attestationSignature = attestation.signature
    }

    if (body.metadata.isMembership === 'false') {
      const attestation = await getDonationAttestation({
        donorName: body.metadata.donorName,
        donorEmail: body.metadata.donorEmail,
        donation,
      })

      attestationMessage = attestation.message
      attestationSignature = attestation.signature
    }

    try {
      await sendDonationConfirmationEmail({
        to: body.metadata.donorEmail,
        donorName: body.metadata.donorName,
        donation,
        attestationMessage,
        attestationSignature,
      })
    } catch (error) {
      log(
        'warn',
        `[BTCPay webhook] Failed to send donation confirmation email for invoice ${body.invoiceId}. NOT rolling back. Cause:`
      )
      console.error(error)
    }
  }

  try {
    const fundSlug = body.metadata.fundSlug
    const projectSlug = body.metadata.projectSlug
    await Promise.all([
      res.revalidate('/'),
      res.revalidate(`/${fundSlug}/projects`),
      res.revalidate(`/${fundSlug}`),
      res.revalidate(`/${fundSlug}/projects/${projectSlug}`),
    ])
  } catch (err) {
    log('warn', `[BTCPay webhook] Failed to revalidate pages for invoice ${body.invoiceId}.`)
  }

  log('info', `[BTCPay webhook] Successfully processed invoice ${body.invoiceId}!`)
}

async function handleBtcpayWebhook(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
    return
  }

  if (typeof req.headers['btcpay-sig'] !== 'string') {
    res.status(400).json({ success: false })
    return
  }

  const rawBody = await getRawBody(req)
  const body: WebhookBody = JSON.parse(Buffer.from(rawBody).toString('utf8'))

  const expectedSigHash = crypto
    .createHmac('sha256', env.BTCPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')

  const incomingSigHash = (req.headers['btcpay-sig'] as string).split('=')[1]

  if (expectedSigHash !== incomingSigHash) {
    console.error('Invalid signature')
    res.status(401).json({ success: false })
    return
  }

  if (!body.metadata) {
    return res.status(200).json({ success: true })
  }

  if (body.type === 'InvoicePaymentSettled') {
    // Handle payments to funding required API invoices ONLY
    if (body.metadata.staticGeneratedForApi === 'false') {
      return res.status(200).json({ success: true })
    }

    await handleFundingRequiredApiDonation(body, res)
  }

  if (body.type === 'InvoiceSettled') {
    // If this is a funding required API invoice, let InvoiceReceivedPayment handle it instead
    if (body.metadata.staticGeneratedForApi === 'true') {
      return res.status(200).json({ success: true })
    }

    await handleDonationOrMembership(body, res)
  }

  res.status(200).json({ success: true })
}

export default handleBtcpayWebhook
