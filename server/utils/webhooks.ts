import { NextApiRequest, NextApiResponse } from 'next'
import { FundSlug } from '@prisma/client'
import Stripe from 'stripe'
import getRawBody from 'raw-body'
import dayjs from 'dayjs'

import {
  btcpayApi as _btcpayApi,
  prisma,
  stripe as _stripe,
  strapiApi,
} from '../../server/services'
import { DonationMetadata, StrapiCreatePointBody } from '../../server/types'
import { sendDonationConfirmationEmail } from './mailing'
import { getPointsBalance, givePointsToUser } from './perks'
import { NET_DONATION_AMOUNT_WITH_POINTS_RATE, POINTS_PER_USD } from '../../config'
import { getDonationAttestation, getMembershipAttestation } from './attestation'
import { addUserToPgMembersGroup } from '../../utils/pg-forum-connection'
import { log } from '../../utils/logging'

async function handleDonationOrNonRecurringMembership(paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata as DonationMetadata

  // Payment intents for subscriptions will not have metadata
  if (!metadata) return
  if (JSON.stringify(metadata) === '{}') return
  if (metadata.isSubscription === 'true') return

  // Skip this event if intent is still not fully paid
  if (paymentIntent.amount_received !== paymentIntent.amount) return

  const shouldGivePointsBack = metadata.givePointsBack === 'true'
  const grossFiatAmount = paymentIntent.amount_received / 100
  const netFiatAmount = shouldGivePointsBack
    ? Number((grossFiatAmount * NET_DONATION_AMOUNT_WITH_POINTS_RATE).toFixed(2))
    : grossFiatAmount
  const pointsToGive = shouldGivePointsBack ? Math.floor(grossFiatAmount / POINTS_PER_USD) : 0
  let membershipExpiresAt = null

  const termToMembershipExpiresAt = {
    monthly: dayjs().add(1, 'month').toDate(),
    annually: dayjs().add(1, 'year').toDate(),
  } as const

  if (paymentIntent.metadata.isMembership === 'true' && metadata.membershipTerm) {
    membershipExpiresAt = termToMembershipExpiresAt[metadata.membershipTerm]
  }

  // Add PG forum user to membership group
  if (metadata.isMembership && metadata.fundSlug === 'privacyguides' && metadata.userId) {
    await addUserToPgMembersGroup(metadata.userId)
  }

  const donation = await prisma.donation.create({
    data: {
      userId: metadata.userId,
      stripePaymentIntentId: paymentIntent.id,
      projectName: metadata.projectName,
      projectSlug: metadata.projectSlug,
      fundSlug: metadata.fundSlug,
      grossFiatAmount,
      netFiatAmount,
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
      log('error', `[Stripe webhook] Failed to give points. Rolling back.`)
      prisma.donation.delete({ where: { id: donation.id } })
      throw error
    }
  }

  // Get attestation and send confirmation email
  if (metadata.donorEmail && metadata.donorName) {
    let attestationMessage = ''
    let attestationSignature = ''

    if (metadata.isMembership === 'true' && metadata.membershipTerm) {
      const attestation = await getMembershipAttestation({
        donorName: metadata.donorName,
        donorEmail: metadata.donorEmail,
        donation,
        totalAmountToDate: grossFiatAmount,
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
      sendDonationConfirmationEmail({
        to: metadata.donorEmail,
        donorName: metadata.donorName,
        donation,
        attestationMessage,
        attestationSignature,
      })
    } catch (error) {
      log(
        'warn',
        `[Stripe webhook] Failed to send donation confirmation email for payment intent ${paymentIntent.id}. NOT rolling back. Cause ${error}`
      )
    }
  }

  log('info', `[Stripe webhook] Successfully processed payment intent ${paymentIntent.id}!`)
}

async function handleRecurringMembership(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return

  const metadata = invoice.subscription_details?.metadata as DonationMetadata
  const invoiceLine = invoice.lines.data.find((line) => line.invoice === invoice.id)

  if (!invoiceLine) {
    log(
      'info',
      `[/api/stripe/${metadata.fundSlug}-webhook] Line not fund for invoice ${invoice.id}. Skipping.`
    )
    return
  }

  const shouldGivePointsBack = metadata.givePointsBack === 'true'
  const grossFiatAmount = invoice.total / 100
  const netFiatAmount = shouldGivePointsBack
    ? Number((grossFiatAmount * NET_DONATION_AMOUNT_WITH_POINTS_RATE).toFixed(2))
    : grossFiatAmount
  const pointsToGive = shouldGivePointsBack ? parseInt(String(grossFiatAmount * 100)) : 0
  const membershipExpiresAt = new Date(invoiceLine.period.end * 1000)

  // Add PG forum user to membership group
  if (metadata.isMembership && metadata.fundSlug === 'privacyguides' && metadata.userId) {
    await addUserToPgMembersGroup(metadata.userId)
  }

  const donation = await prisma.donation.create({
    data: {
      userId: metadata.userId as string,
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: invoice.subscription.toString(),
      projectName: metadata.projectName,
      projectSlug: metadata.projectSlug,
      fundSlug: metadata.fundSlug,
      grossFiatAmount,
      netFiatAmount,
      pointsAdded: pointsToGive,
      membershipExpiresAt,
      membershipTerm: metadata.membershipTerm || null,
      showDonorNameOnLeaderboard: metadata.showDonorNameOnLeaderboard === 'true',
      donorName: metadata.donorName,
    },
  })

  // Add points
  if (shouldGivePointsBack && metadata.userId) {
    // Get balance for project/fund by finding user's last point history
    const currentBalance = await getPointsBalance(metadata.userId)

    try {
      await givePointsToUser({ donation, pointsToGive })
    } catch (error) {
      log('error', `[BTCPay webhook] Failed to give points. Rolling back.`)
      prisma.donation.delete({ where: { id: donation.id } })
      throw error
    }
  }

  if (metadata.donorEmail && metadata.donorName && metadata.membershipTerm) {
    const donations = await prisma.donation.findMany({
      where: {
        stripeSubscriptionId: invoice.subscription.toString(),
        membershipExpiresAt: { not: null },
      },
      orderBy: { membershipExpiresAt: 'desc' },
    })

    const membershipStart = donations.slice(-1)[0].createdAt

    const membershipValue = donations.reduce(
      (total, donation) => total + donation.grossFiatAmount,
      0
    )

    const attestation = await getMembershipAttestation({
      donorName: metadata.donorName,
      donorEmail: metadata.donorEmail,
      donation,
      totalAmountToDate: membershipValue,
      periodStart: membershipStart,
    })

    try {
      sendDonationConfirmationEmail({
        to: metadata.donorEmail,
        donorName: metadata.donorName,
        donation,
        attestationMessage: attestation.message,
        attestationSignature: attestation.signature,
      })
    } catch (error) {
      log(
        'warn',
        `[Stripe webhook] Failed to send donation confirmation email for invoice ${invoice.id}. NOT rolling back. Cause ${error}`
      )
    }
  }

  log('info', `[Stripe webhook] Successfully processed invoice ${invoice.id}!`)
}

export function getStripeWebhookHandler(fundSlug: FundSlug, secret: string) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    let event: Stripe.Event

    // Get the signature sent by Stripe
    const signature = req.headers['stripe-signature']

    try {
      const stripe = _stripe[fundSlug]
      event = stripe.webhooks.constructEvent(await getRawBody(req), signature!, secret)
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`, (err as any).message)
      res.status(400).end()
      return
    }

    // Store donation data when payment intent is valid
    // Subscriptions are handled on the invoice.paid event instead
    if (event.type === 'payment_intent.succeeded') {
      handleDonationOrNonRecurringMembership(event.data.object)
    }

    // Store subscription data when subscription invoice is paid
    if (event.type === 'invoice.paid') {
      handleRecurringMembership(event.data.object)
    }

    // Return a 200 response to acknowledge receipt of the event
    res.status(200).end()
  }
}
