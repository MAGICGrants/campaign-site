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
  privacyGuidesDiscourseApi,
} from '../../server/services'
import { DonationMetadata, StrapiCreatePointBody } from '../../server/types'
import { sendDonationConfirmationEmail } from './mailing'
import { getUserPointBalance } from './perks'
import { POINTS_PER_USD } from '../../config'
import { env } from '../../env.mjs'
import { getDonationAttestation, getMembershipAttestation } from './attestation'
import { funds } from '../../utils/funds'
import { addUserToPgMembersGroup } from '../../utils/pg-forum-connection'

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
      const paymentIntent = event.data.object
      const metadata = paymentIntent.metadata as DonationMetadata

      // Payment intents for subscriptions will not have metadata
      if (!metadata) return res.status(200).end()
      if (JSON.stringify(metadata) === '{}') return res.status(200).end()
      if (metadata.isSubscription === 'true') return res.status(200).end()

      // Skip this event if intent is still not fully paid
      if (paymentIntent.amount_received !== paymentIntent.amount) return res.status(200).end()

      const shouldGivePointsBack = metadata.givePointsBack === 'true'
      const grossFiatAmount = paymentIntent.amount_received / 100
      const netFiatAmount = shouldGivePointsBack
        ? Number((grossFiatAmount * 0.9).toFixed(2))
        : grossFiatAmount
      const pointsAdded = shouldGivePointsBack ? Math.floor(grossFiatAmount / POINTS_PER_USD) : 0
      let membershipExpiresAt = null

      if (
        paymentIntent.metadata.isMembership === 'true' &&
        paymentIntent.metadata.membershipTerm === 'monthly'
      ) {
        membershipExpiresAt = dayjs().add(1, 'month').toDate()
      }

      if (
        paymentIntent.metadata.isMembership === 'true' &&
        paymentIntent.metadata.membershipTerm === 'annually'
      ) {
        membershipExpiresAt = dayjs().add(1, 'year').toDate()
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
          pointsAdded,
          membershipExpiresAt,
          membershipTerm: metadata.membershipTerm,
          showDonorNameOnLeaderboard: metadata.showDonorNameOnLeaderboard === 'true',
          donorName: metadata.donorName,
        },
      })

      // Add points
      if (shouldGivePointsBack && metadata.userId) {
        // Get balance for project/fund by finding user's last point history
        const currentBalance = await getUserPointBalance(metadata.userId)

        await strapiApi.post<any, any, StrapiCreatePointBody>('/points', {
          data: {
            balanceChange: pointsAdded.toString(),
            balance: (currentBalance + pointsAdded).toString(),
            userId: metadata.userId,
            donationId: donation.id,
            donationProjectName: donation.projectName,
            donationProjectSlug: donation.projectSlug,
            donationFundSlug: donation.fundSlug,
          },
        })
      }

      // Get attestation and send confirmation email
      if (metadata.donorEmail && metadata.donorName) {
        let attestationMessage = ''
        let attestationSignature = ''

        if (metadata.isMembership === 'true' && metadata.membershipTerm) {
          const attestation = await getMembershipAttestation({
            donorName: metadata.donorName,
            donorEmail: metadata.donorEmail,
            amount: Number(grossFiatAmount.toFixed(2)),
            term: metadata.membershipTerm,
            method: 'Fiat',
            fundName: funds[metadata.fundSlug].title,
            fundSlug: metadata.fundSlug,
            periodStart: new Date(),
            periodEnd: membershipExpiresAt!,
          })

          attestationMessage = attestation.message
          attestationSignature = attestation.signature
        }

        if (metadata.isMembership === 'false') {
          const attestation = await getDonationAttestation({
            donorName: metadata.donorName,
            donorEmail: metadata.donorEmail,
            amount: grossFiatAmount,
            method: 'Fiat',
            fundName: funds[metadata.fundSlug].title,
            fundSlug: metadata.fundSlug,
            projectName: metadata.projectName,
            date: new Date(),
            donationId: donation.id,
          })

          attestationMessage = attestation.message
          attestationSignature = attestation.signature
        }

        sendDonationConfirmationEmail({
          to: metadata.donorEmail,
          donorName: metadata.donorName,
          fundSlug: metadata.fundSlug,
          projectName: metadata.projectName,
          isMembership: metadata.isMembership === 'true',
          isSubscription: false,
          stripeUsdAmount: paymentIntent.amount_received / 100,
          pointsReceived: pointsAdded,
          attestationMessage,
          attestationSignature,
        })
      }
    }

    // Store subscription data when subscription invoice is paid
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object

      if (!invoice.subscription) return res.status(200).end()

      const metadata = event.data.object.subscription_details?.metadata as DonationMetadata
      const invoiceLine = invoice.lines.data.find((line) => line.invoice === invoice.id)

      if (!invoiceLine) {
        console.error(
          `[/api/stripe/${metadata.fundSlug}-webhook] Line not fund for invoice ${invoice.id}`
        )
        return res.status(200).end()
      }

      const shouldGivePointsBack = metadata.givePointsBack === 'true'
      const grossFiatAmount = invoice.total / 100
      const netFiatAmount = shouldGivePointsBack
        ? Number((grossFiatAmount * 0.9).toFixed(2))
        : grossFiatAmount
      const pointsAdded = shouldGivePointsBack ? parseInt(String(grossFiatAmount * 100)) : 0
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
          pointsAdded,
          membershipExpiresAt,
          membershipTerm: metadata.membershipTerm,
          showDonorNameOnLeaderboard: metadata.showDonorNameOnLeaderboard === 'true',
          donorName: metadata.donorName,
        },
      })

      // Add points
      if (shouldGivePointsBack && metadata.userId) {
        // Get balance for project/fund by finding user's last point history
        const currentBalance = await getUserPointBalance(metadata.userId)

        await strapiApi.post('/points', {
          data: {
            balanceChange: pointsAdded,
            pointsBalance: currentBalance + pointsAdded,
            userId: metadata.userId,
            donationId: donation.id,
            donationProjectName: donation.projectName,
            donationProjectSlug: donation.projectSlug,
            donationFundSlug: donation.fundSlug,
          },
        })
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
          amount: membershipValue,
          method: 'Fiat',
          term: metadata.membershipTerm,
          fundName: funds[metadata.fundSlug].title,
          fundSlug: metadata.fundSlug,
          periodStart: membershipStart,
          periodEnd: membershipExpiresAt,
        })

        sendDonationConfirmationEmail({
          to: metadata.donorEmail,
          donorName: metadata.donorName,
          fundSlug: metadata.fundSlug,
          projectName: metadata.projectName,
          isMembership: metadata.isMembership === 'true',
          isSubscription: metadata.isSubscription === 'true',
          stripeUsdAmount: invoice.total / 100,
          pointsReceived: pointsAdded,
          attestationMessage: attestation.message,
          attestationSignature: attestation.signature,
        })
      }
    }

    // Handle subscription end
    if (event.type === 'customer.subscription.deleted') {
      console.log(event.data.object)
    }

    // Return a 200 response to acknowledge receipt of the event
    res.status(200).end()
  }
}
