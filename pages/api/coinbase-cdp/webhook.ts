import { NextApiRequest, NextApiResponse } from 'next'
import getRawBody from 'raw-body'

import { env } from '../../../env.mjs'
import { DonationCryptoPayments } from '../../../server/types'
import { prisma } from '../../../server/services'
import { log } from '../../../utils/logging'
import dayjs from 'dayjs'
import { NET_DONATION_AMOUNT_WITH_POINTS_RATE, POINTS_PER_USD } from '../../../config'
import { givePointsToUser } from '../../../server/utils/perks'
import { addUserToPgMembersGroup } from '../../../utils/pg-forum-connection'
import { getDonationAttestation, getMembershipAttestation } from '../../../server/utils/attestation'
import { sendDonationConfirmationEmail } from '../../../server/utils/mailing'
import {
  checkoutMetadataToDonationMetadata,
  verifyCoinbaseCdpHookSignature,
  type CheckoutWebhookPayload,
} from '../../../server/utils/coinbase-checkout-webhook'

export const config = {
  api: {
    bodyParser: false,
  },
}
async function handleCheckoutPaid(body: CheckoutWebhookPayload, res: NextApiResponse) {
  const metadata = checkoutMetadataToDonationMetadata(body.metadata)
  if (!metadata || !metadata.projectSlug) {
    log('warn', '[Coinbase CDP webhook] Missing or invalid metadata on checkout event')
    return
  }

  const checkoutId = body.id

  const existingDonation = await prisma.donation.findFirst({
    where: { coinbaseChargeId: checkoutId },
  })

  if (existingDonation) {
    log('warn', `[Coinbase CDP webhook] Already processed checkout ${checkoutId}`)
    return
  }

  const termToMembershipExpiresAt = {
    monthly: dayjs().add(1, 'month').toDate(),
    annually: dayjs().add(1, 'year').toDate(),
  } as const

  let membershipExpiresAt = null

  if (metadata.isMembership === 'true' && metadata.membershipTerm) {
    membershipExpiresAt = termToMembershipExpiresAt[metadata.membershipTerm]
  }

  const shouldGivePointsBack = metadata.givePointsBack === 'true'

  const grossFiatAmount = Number(body.amount)

  const netFiatAmount = shouldGivePointsBack
    ? grossFiatAmount * NET_DONATION_AMOUNT_WITH_POINTS_RATE
    : grossFiatAmount

  const pointsToGive = shouldGivePointsBack ? Math.floor(grossFiatAmount / POINTS_PER_USD) : 0

  const totalStr = body.settlement?.totalAmount ?? body.amount
  const netStr = body.settlement?.netAmount ?? body.amount
  const settlementTotal = Number(totalStr)
  const settlementNet = Number(netStr)
  const cryptoPayments: DonationCryptoPayments = [
    {
      cryptoCode: body.currency,
      grossAmount: totalStr,
      netAmount: String(
        shouldGivePointsBack
          ? settlementNet * NET_DONATION_AMOUNT_WITH_POINTS_RATE
          : settlementNet
      ),
      rate: settlementTotal > 0 ? String(settlementNet / settlementTotal) : '1',
    },
  ]

  const donation = await prisma.donation.create({
    data: {
      userId: metadata.userId,
      coinbaseChargeId: checkoutId,
      projectName: metadata.projectName,
      projectSlug: metadata.projectSlug,
      fundSlug: metadata.fundSlug,
      cryptoPayments,
      grossFiatAmount: Number(grossFiatAmount.toFixed(2)),
      netFiatAmount: Number(netFiatAmount.toFixed(2)),
      pointsAdded: pointsToGive,
      membershipExpiresAt,
      membershipTerm: metadata.membershipTerm || null,
      showDonorNameOnLeaderboard: metadata.showDonorNameOnLeaderboard === 'true',
      donorName: metadata.donorName,
      donorNameIsProfane: metadata.donorNameIsProfane === 'true',
    },
  })

  if (shouldGivePointsBack && metadata.userId) {
    try {
      await givePointsToUser({ pointsToGive, donation })
    } catch (error) {
      log('error', `[Coinbase CDP webhook] Failed to give points for checkout ${checkoutId}. Rolling back.`)
      await prisma.donation.delete({ where: { id: donation.id } })
      throw error
    }
  }

  if (metadata.isMembership && metadata.fundSlug === 'privacyguides' && metadata.userId) {
    try {
      await addUserToPgMembersGroup(metadata.userId)
    } catch (error) {
      log(
        'warn',
        `[Coinbase CDP webhook] Could not add user ${metadata.userId} to PG forum members group. Checkout: ${checkoutId}. NOT rolling back. Continuing... Cause:`
      )
      console.error(error)
    }
  }

  if (metadata.donorEmail && metadata.donorName) {
    let attestationMessage = ''
    let attestationSignature = ''

    if (metadata.isMembership === 'true' && metadata.membershipTerm) {
      const attestation = await getMembershipAttestation({
        donorName: metadata.donorName,
        donorEmail: metadata.donorEmail,
        totalAmountToDate: grossFiatAmount,
        donation,
      })

      attestationMessage = attestation.message
      attestationSignature = attestation.signature
    }

    if (metadata.isMembership === 'false') {
      const attestation = await getDonationAttestation({
        donorName: metadata.donorName,
        donorEmail: metadata.donorEmail,
        donation,
      })

      attestationMessage = attestation.message
      attestationSignature = attestation.signature
    }

    try {
      await sendDonationConfirmationEmail({
        to: metadata.donorEmail,
        donorName: metadata.donorName,
        donation,
        attestationMessage,
        attestationSignature,
      })
    } catch (error) {
      log(
        'warn',
        `[Coinbase CDP webhook] Failed to send donation confirmation email for checkout ${checkoutId}. NOT rolling back. Cause:`
      )
      console.error(error)
    }
  }

  try {
    await Promise.all([
      res.revalidate('/'),
      res.revalidate(`/${metadata.fundSlug}/projects`),
      res.revalidate(`/${metadata.fundSlug}`),
      res.revalidate(`/${metadata.fundSlug}/projects/${metadata.projectSlug}`),
    ])
  } catch (err) {
    log('warn', `[Coinbase CDP webhook] Failed to revalidate pages for checkout ${checkoutId}.`)
  }

  log('info', `[Coinbase CDP webhook] Successfully processed checkout ${checkoutId}`)
}

async function handleCoinbaseCdpWebhook(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
    return
  }

  const rawBuffer = await getRawBody(req)
  const rawBody = Buffer.from(rawBuffer).toString('utf8')

  const signatureHeader =
    typeof req.headers['x-hook0-signature'] === 'string'
      ? req.headers['x-hook0-signature']
      : typeof req.headers['X-Hook0-Signature'] === 'string'
        ? (req.headers['X-Hook0-Signature'] as string)
        : undefined

  if (!verifyCoinbaseCdpHookSignature(rawBody, signatureHeader, env.COINBASE_CDP_WEBHOOK_SECRET, req.headers)) {
    console.error('Invalid Coinbase CDP webhook signature')
    res.status(401).json({ success: false })
    return
  }

  const body = JSON.parse(rawBody) as CheckoutWebhookPayload

  if (body.eventType === 'checkout.payment.success') {
    await handleCheckoutPaid(body, res)
  }

  res.status(200).json({ success: true })
}

export default handleCoinbaseCdpWebhook
