import { NextApiRequest, NextApiResponse } from 'next'
import getRawBody from 'raw-body'
import crypto from 'crypto'

import { env } from '../../../env.mjs'
import { DonationCryptoPayments, DonationMetadata } from '../../../server/types'
import { prisma } from '../../../server/services'
import { log } from '../../../utils/logging'
import dayjs from 'dayjs'
import { NET_DONATION_AMOUNT_WITH_POINTS_RATE, POINTS_PER_USD } from '../../../config'
import { givePointsToUser } from '../../../server/utils/perks'
import { addUserToPgMembersGroup } from '../../../utils/pg-forum-connection'
import { getDonationAttestation, getMembershipAttestation } from '../../../server/utils/attestation'
import { sendDonationConfirmationEmail } from '../../../server/utils/mailing'

export const config = {
  api: {
    bodyParser: false,
  },
}

type WebhookBody = {
  id: string
  scheduled_for: string
  attempt_number: number
  event: {
    id: string
    resource: string
    type: string
    api_version: string
    created_at: string
    data: {
      code: string
      id: string
      resource: string
      name: string
      description: string
      hosted_url: string
      created_at: string
      expires_at: string
      support_email: string
      pricing_type: string
      pricing: {
        local: {
          amount: string
          currency: string
        }
        settlement: {
          amount: string
          currency: string
        }
      }
      pwcb_only: boolean
      offchain_eligible: boolean
      coinbase_managed_merchant: boolean
      collected_email: boolean
      fee_rate: number
      metadata: DonationMetadata
    }
  }
}

async function handleDonationOrMembership(body: WebhookBody) {
  if (!body.event.data.metadata || JSON.stringify(body.event.data.metadata) === '{}') return

  const metadata: DonationMetadata = body.event.data.metadata
  const chargeId = body.event.data.id

  const existingDonation = await prisma.donation.findFirst({
    where: { coinbaseChargeId: chargeId },
  })

  if (existingDonation) {
    log('warn', `[Coinbase webhook] Attempted to process already processed charge ${chargeId}.`)
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

  const grossFiatAmount = Number(body.event.data.pricing.local.amount)

  const netFiatAmount = shouldGivePointsBack
    ? grossFiatAmount * NET_DONATION_AMOUNT_WITH_POINTS_RATE
    : grossFiatAmount

  const pointsToGive = shouldGivePointsBack ? Math.floor(grossFiatAmount / POINTS_PER_USD) : 0

  const cryptoPayments: DonationCryptoPayments = [
    {
      cryptoCode: body.event.data.pricing.settlement.currency,
      grossAmount: Number(body.event.data.pricing.settlement.amount),
      netAmount:
        Number(body.event.data.pricing.settlement.amount) * NET_DONATION_AMOUNT_WITH_POINTS_RATE,
      rate: Number(body.event.data.pricing.settlement.amount) / grossFiatAmount,
    },
  ]

  const donation = await prisma.donation.create({
    data: {
      userId: metadata.userId,
      coinbaseChargeId: chargeId,
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
    },
  })

  // Add points
  if (shouldGivePointsBack && metadata.userId) {
    try {
      await givePointsToUser({ pointsToGive, donation })
    } catch (error) {
      log('error', `[Coinbase webhook] Failed to give points for charge ${chargeId}. Rolling back.`)
      await prisma.donation.delete({ where: { id: donation.id } })
      throw error
    }
  }

  // Add PG forum user to membership group
  if (metadata.isMembership && metadata.fundSlug === 'privacyguides' && metadata.userId) {
    try {
      await addUserToPgMembersGroup(metadata.userId)
    } catch (error) {
      log(
        'warn',
        `[Coinbase webhook] Could not add user ${metadata.userId} to PG forum members group. Charge: ${chargeId}. NOT rolling back. Continuing... Cause:`
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
        `[Coinbase webhook] Failed to send donation confirmation email for charge ${chargeId}. NOT rolling back. Cause:`
      )
      console.error(error)
    }
  }

  log('info', `[Coinbase webhook] Successfully processed charge ${chargeId}!`)
}

async function handleCoinbaseCommerceWebhook(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
    return
  }

  if (typeof req.headers['x-cc-webhook-signature'] !== 'string') {
    res.status(400).json({ success: false })
    return
  }

  const rawBody = await getRawBody(req)
  const body: WebhookBody = JSON.parse(Buffer.from(rawBody).toString('utf8'))

  const expectedSigHash = crypto
    .createHmac('sha256', env.COINBASE_COMMERCE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')

  const incomingSigHash = req.headers['x-cc-webhook-signature'] as string

  if (expectedSigHash !== incomingSigHash) {
    console.error('Invalid signature')
    res.status(401).json({ success: false })
    return
  }

  if (body.event.type === 'charge:confirmed') {
    await handleDonationOrMembership(body)
  }

  res.status(200).json({ success: true })
}

export default handleCoinbaseCommerceWebhook
