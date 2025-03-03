import { Stripe } from 'stripe'
import { TRPCError } from '@trpc/server'
import { Donation } from '@prisma/client'
import { z } from 'zod'
import UserRepresentation from '@keycloak/keycloak-admin-client/lib/defs/userRepresentation'

import { protectedProcedure, publicProcedure, router } from '../trpc'
import {
  CURRENCY,
  MAX_AMOUNT,
  ANNUALLY_MEMBERSHIP_MIN_PRICE_USD,
  MIN_AMOUNT,
  MONTHLY_MEMBERSHIP_MIN_PRICE_USD,
} from '../../config'
import { env } from '../../env.mjs'
import { btcpayApi, keycloak, prisma, stripe as _stripe } from '../services'
import { authenticateKeycloakClient } from '../utils/keycloak'
import { BtcPayCreateInvoiceRes, DonationMetadata } from '../types'
import { funds, fundSlugs } from '../../utils/funds'
import { fundSlugToCustomerIdAttr } from '../utils/funds'
import { getDonationAttestation, getMembershipAttestation } from '../utils/attestation'

export const donationRouter = router({
  donateWithFiat: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).nullable(),
        email: z.string().email().nullable(),
        projectName: z.string().min(1),
        projectSlug: z.string().min(1),
        fundSlug: z.enum(fundSlugs),
        amount: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
        taxDeductible: z.boolean(),
        givePointsBack: z.boolean(),
        showDonorNameOnLeaderboard: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user.sub || null

      if (!userId && input.showDonorNameOnLeaderboard && !input.name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Name is required when you want it to be on the leaderboard.',
        })
      }

      if (!userId && input.taxDeductible && !input.name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Name is required when the donation is tax deductible.',
        })
      }

      if (!userId && input.taxDeductible && !input.email) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Email is required when the donation is tax deductible.',
        })
      }

      let email = input.email
      let name = input.name
      let stripeCustomerId: string | null = null
      let user: UserRepresentation | null = null

      if (userId) {
        await authenticateKeycloakClient()
        user = (await keycloak.users.findOne({ id: userId })!) || null
        email = user?.email!
        name = user?.attributes?.name?.[0]
        stripeCustomerId = user?.attributes?.[fundSlugToCustomerIdAttr[input.fundSlug]]?.[0] || null
      }

      const stripe = _stripe[input.fundSlug]

      if (!stripeCustomerId && userId && user && email && name) {
        const customer = await stripe.customers.create({
          email,
          name,
        })

        stripeCustomerId = customer.id

        await keycloak.users.update(
          { id: userId },
          { ...user, attributes: { ...user.attributes, stripeCustomerId } }
        )
      }

      const metadata: DonationMetadata = {
        userId,
        donorEmail: email,
        donorName: name,
        projectSlug: input.projectSlug,
        projectName: input.projectName,
        fundSlug: input.fundSlug,
        isMembership: 'false',
        isSubscription: 'false',
        membershipTerm: null,
        isTaxDeductible: input.taxDeductible ? 'true' : 'false',
        staticGeneratedForApi: 'false',
        givePointsBack: input.givePointsBack ? 'true' : 'false',
        showDonorNameOnLeaderboard: input.showDonorNameOnLeaderboard ? 'true' : 'false',
      }

      const params: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        submit_type: 'donate',
        customer: stripeCustomerId || undefined,
        currency: CURRENCY,
        line_items: [
          {
            price_data: {
              currency: CURRENCY,
              product_data: {
                name: `MAGIC Grants donation: ${input.projectName}`,
              },
              unit_amount: input.amount * 100,
            },
            quantity: 1,
          },
        ],
        metadata,
        success_url: `${env.APP_URL}/${input.fundSlug}/thankyou`,
        cancel_url: `${env.APP_URL}/`,
        // We need metadata in here for some reason
        payment_intent_data: { metadata },
      }

      const checkoutSession = await stripe.checkout.sessions.create(params)

      return { url: checkoutSession.url }
    }),

  donateWithCrypto: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).nullable(),
        email: z.string().trim().email().nullable(),
        projectName: z.string().min(1),
        projectSlug: z.string().min(1),
        fundSlug: z.enum(fundSlugs),
        amount: z.number().min(MIN_AMOUNT).max(MAX_AMOUNT),
        taxDeductible: z.boolean(),
        givePointsBack: z.boolean(),
        showDonorNameOnLeaderboard: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let email = input.email
      let name = input.name
      const userId = ctx.session?.user.sub || null

      if (userId) {
        await authenticateKeycloakClient()
        const user = await keycloak.users.findOne({ id: userId })
        email = user?.email!
        name = user?.attributes?.name?.[0] || null
      }

      const metadata: DonationMetadata = {
        userId,
        donorName: name,
        donorEmail: email,
        projectSlug: input.projectSlug,
        projectName: input.projectName,
        fundSlug: input.fundSlug,
        itemDesc: `MAGIC ${funds[input.fundSlug].title}`,
        isMembership: 'false',
        membershipTerm: null,
        isSubscription: 'false',
        isTaxDeductible: input.taxDeductible ? 'true' : 'false',
        staticGeneratedForApi: 'false',
        givePointsBack: input.givePointsBack ? 'true' : 'false',
        showDonorNameOnLeaderboard: input.showDonorNameOnLeaderboard ? 'true' : 'false',
      }

      const { data: invoice } = await btcpayApi.post<BtcPayCreateInvoiceRes>(`/invoices`, {
        amount: input.amount,
        currency: CURRENCY,
        metadata,
        checkout: { redirectURL: `${env.APP_URL}/${input.fundSlug}/thankyou` },
      })

      const url = invoice.checkoutLink.replace(/^(https?:\/\/)([^\/]+)/, env.BTCPAY_EXTERNAL_URL)

      return { url }
    }),

  payMembershipWithFiat: protectedProcedure
    .input(
      z.object({
        fundSlug: z.enum(fundSlugs),
        amount: z.number(),
        term: z.enum(['monthly', 'annually']),
        recurring: z.boolean(),
        taxDeductible: z.boolean(),
        givePointsBack: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const stripe = _stripe[input.fundSlug]
      const userId = ctx.session.user.sub

      if (input.term === 'monthly' && input.amount < MONTHLY_MEMBERSHIP_MIN_PRICE_USD) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Min. monthly amount is $${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }

      if (input.term === 'annually' && input.amount < ANNUALLY_MEMBERSHIP_MIN_PRICE_USD) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Min. anually amount is $${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }

      const userHasMembership = await prisma.donation.findFirst({
        where: {
          userId,
          projectSlug: input.fundSlug,
          membershipExpiresAt: { gt: new Date() },
        },
      })

      if (userHasMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'USER_HAS_ACTIVE_MEMBERSHIP',
        })
      }

      await authenticateKeycloakClient()
      const user = await keycloak.users.findOne({ id: userId })
      const email = user?.email!
      const name = user?.attributes?.name?.[0]!

      if (!user || !user.id)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'USER_NOT_FOUND',
        })

      let stripeCustomerId =
        user?.attributes?.[fundSlugToCustomerIdAttr[input.fundSlug]]?.[0] || null

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({ email, name })

        stripeCustomerId = customer.id

        await keycloak.users.update(
          { id: userId },
          { ...user, attributes: { ...user.attributes, stripeCustomerId } }
        )
      }

      const metadata: DonationMetadata = {
        userId,
        donorName: name,
        donorEmail: email,
        projectSlug: input.fundSlug,
        projectName: funds[input.fundSlug].title,
        fundSlug: input.fundSlug,
        isMembership: 'true',
        membershipTerm: input.term,
        isSubscription: input.recurring ? 'true' : 'false',
        isTaxDeductible: input.taxDeductible ? 'true' : 'false',
        staticGeneratedForApi: 'false',
        givePointsBack: input.givePointsBack ? 'true' : 'false',
        showDonorNameOnLeaderboard: 'false',
      }

      const purchaseParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        submit_type: 'donate',
        customer: stripeCustomerId || undefined,
        currency: CURRENCY,
        line_items: [
          {
            price_data: {
              currency: CURRENCY,
              product_data: {
                name: `MAGIC Grants ${input.term === 'annually' ? 'Annual' : 'Monthly'} Membership: ${funds[input.fundSlug].title}`,
              },
              unit_amount: input.amount * 100,
            },
            quantity: 1,
          },
        ],
        metadata,
        success_url: `${env.APP_URL}/${input.fundSlug}/thankyou`,
        cancel_url: `${env.APP_URL}/`,
        payment_intent_data: { metadata },
      }

      const subscriptionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        customer: stripeCustomerId || undefined,
        currency: CURRENCY,
        line_items: [
          {
            price_data: {
              currency: CURRENCY,
              product_data: {
                name: `MAGIC Grants ${input.term === 'annually' ? 'Annual' : 'Monthly'} Membership: ${funds[input.fundSlug].title}`,
              },
              recurring: { interval: input.term === 'annually' ? 'year' : 'month' },
              unit_amount: input.amount * 100,
            },
            quantity: 1,
          },
        ],
        metadata,
        success_url: `${env.APP_URL}/${input.fundSlug}/thankyou`,
        cancel_url: `${env.APP_URL}/`,
        subscription_data: { metadata },
      }

      const checkoutSession = await stripe.checkout.sessions.create(
        input.recurring ? subscriptionParams : purchaseParams
      )

      return { url: checkoutSession.url }
    }),

  payMembershipWithCrypto: protectedProcedure
    .input(
      z.object({
        fundSlug: z.enum(fundSlugs),
        amount: z.number(),
        term: z.enum(['monthly', 'annually']),
        taxDeductible: z.boolean(),
        givePointsBack: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.term === 'monthly' && input.amount < MONTHLY_MEMBERSHIP_MIN_PRICE_USD) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Min. monthly amount is $${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }

      if (input.term === 'annually' && input.amount < ANNUALLY_MEMBERSHIP_MIN_PRICE_USD) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Min. anually amount is $${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }

      const userId = ctx.session.user.sub

      const userHasMembership = await prisma.donation.findFirst({
        where: {
          userId,
          projectSlug: input.fundSlug,
          membershipExpiresAt: { gt: new Date() },
        },
      })

      if (userHasMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'USER_HAS_ACTIVE_MEMBERSHIP',
        })
      }

      await authenticateKeycloakClient()
      const user = await keycloak.users.findOne({ id: userId })
      const email = user?.email!
      const name = user?.attributes?.name?.[0]!

      const metadata: DonationMetadata = {
        userId,
        donorName: name,
        donorEmail: email,
        projectSlug: input.fundSlug,
        projectName: funds[input.fundSlug].title,
        itemDesc: `MAGIC ${funds[input.fundSlug].title}`,
        fundSlug: input.fundSlug,
        isMembership: 'true',
        membershipTerm: input.term,
        isSubscription: 'false',
        isTaxDeductible: input.taxDeductible ? 'true' : 'false',
        staticGeneratedForApi: 'false',
        givePointsBack: input.givePointsBack ? 'true' : 'false',
        showDonorNameOnLeaderboard: 'false',
      }

      const { data: invoice } = await btcpayApi.post<BtcPayCreateInvoiceRes>(`/invoices`, {
        amount: input.amount,
        currency: CURRENCY,
        metadata,
        checkout: { redirectURL: `${env.APP_URL}/${input.fundSlug}/thankyou` },
      })

      return { url: invoice.checkoutLink }
    }),

  donationList: protectedProcedure
    .input(z.object({ fundSlug: z.enum(fundSlugs) }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.sub

      const donations = await prisma.donation.findMany({
        where: {
          userId,
          membershipExpiresAt: null,
          fundSlug: input.fundSlug,
        },
        orderBy: { createdAt: 'desc' },
      })

      return donations
    }),

  membershipList: protectedProcedure
    .input(z.object({ fundSlug: z.enum(fundSlugs) }))
    .query(async ({ input, ctx }) => {
      const stripe = _stripe[input.fundSlug]
      await authenticateKeycloakClient()
      const userId = ctx.session.user.sub
      const user = await keycloak.users.findOne({ id: userId })
      const stripeCustomerId = user?.attributes?.[fundSlugToCustomerIdAttr[input.fundSlug]]?.[0]
      let billingPortalUrl: string | null = null

      if (stripeCustomerId) {
        const billingPortalSession = await stripe.billingPortal.sessions.create({
          customer: stripeCustomerId,
          return_url: `${env.APP_URL}/${input.fundSlug}/account/my-memberships`,
        })

        billingPortalUrl = billingPortalSession.url
      }

      const memberships = await prisma.donation.findMany({
        where: {
          userId,
          membershipExpiresAt: { not: null },
          fundSlug: input.fundSlug,
        },
        orderBy: { createdAt: 'desc' },
      })

      const subscriptionIds = new Set<string>()
      const membershipsUniqueSubsId: Donation[] = []

      memberships.forEach((membership) => {
        if (!membership.stripeSubscriptionId) {
          membershipsUniqueSubsId.push(membership)
          return
        }

        if (subscriptionIds.has(membership.stripeSubscriptionId)) {
          return
        }

        membershipsUniqueSubsId.push(membership)
        subscriptionIds.add(membership.stripeSubscriptionId)
      })

      return { memberships: membershipsUniqueSubsId, billingPortalUrl }
    }),

  userHasMembership: protectedProcedure
    .input(z.object({ projectSlug: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.sub

      const membership = await prisma.donation.findFirst({
        where: { userId, projectSlug: input.projectSlug, membershipExpiresAt: { gt: new Date() } },
      })

      return !!membership
    }),

  getDonationAttestation: protectedProcedure
    .input(z.object({ donationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.sub

      const donation = await prisma.donation.findFirst({
        where: { id: input.donationId, membershipExpiresAt: null, userId },
      })

      if (!donation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Donation not found.' })
      }

      await authenticateKeycloakClient()

      const user = await keycloak.users.findOne({ id: userId })

      if (!user || !user.id)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'USER_NOT_FOUND',
        })

      const { message, signature } = await getDonationAttestation({
        donorName: user.attributes?.name,
        donorEmail: ctx.session.user.email,
        amount: donation.grossFiatAmount,
        method: donation.cryptoCode ? donation.cryptoCode : 'Fiat',
        fundSlug: donation.fundSlug,
        fundName: funds[donation.fundSlug].title,
        projectName: donation.projectName,
        date: donation.createdAt,
        donationId: donation.id,
      })

      return { message, signature }
    }),

  getMembershipAttestation: protectedProcedure
    .input(z.object({ donationId: z.string().optional(), subscriptionId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.sub

      const donations = await prisma.donation.findMany({
        where: input.subscriptionId
          ? {
              stripeSubscriptionId: input.subscriptionId,
              membershipExpiresAt: { not: null },
              userId,
            }
          : { id: input.donationId, membershipExpiresAt: { not: null }, userId },
        orderBy: { membershipExpiresAt: 'desc' },
      })

      if (!donations.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found.' })
      }

      await authenticateKeycloakClient()

      const user = await keycloak.users.findOne({ id: userId })

      if (!user || !user.id)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'USER_NOT_FOUND',
        })

      const membershipStart = donations.slice(-1)[0].createdAt
      const membershipEnd = donations[0].membershipExpiresAt!

      const membershipValue = donations.reduce(
        (total, donation) => total + donation.grossFiatAmount,
        0
      )

      const { message, signature } = await getMembershipAttestation({
        donorName: user.attributes?.name,
        donorEmail: ctx.session.user.email,
        // For membership donations, a null membership term means that membership is an annual one,
        // since it was started before monthly memberships were introduced.
        term: donations[0].membershipTerm || 'annually',
        amount: membershipValue,
        method: donations[0].cryptoCode ? donations[0].cryptoCode : 'Fiat',
        fundSlug: donations[0].fundSlug,
        fundName: funds[donations[0].fundSlug].title,
        periodStart: membershipStart,
        periodEnd: membershipEnd,
      })

      return { message, signature }
    }),
})
