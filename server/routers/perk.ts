import { z } from 'zod'
import { protectedProcedure, publicProcedure, router } from '../trpc'
import { QueueEvents } from 'bullmq'
import { fundSlugs } from '../../utils/funds'
import { keycloak, printfulApi, strapiApi } from '../services'
import {
  PrintfulGetCountriesRes,
  PrintfulGetProductRes,
  StrapiGetPerkRes,
  StrapiGetPerksPopulatedRes,
  StrapiGetPointsPopulatedRes,
} from '../types'
import { TRPCError } from '@trpc/server'
import { estimatePrintfulOrderCost, getPointsBalance } from '../utils/perks'
import { POINTS_REDEEM_PRICE_USD } from '../../config'
import { authenticateKeycloakClient } from '../utils/keycloak'
import { perkPurchaseQueue } from '../queues'
import { redisConnection } from '../../config/redis'

export const perkRouter = router({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.sub
    const balance = getPointsBalance(userId)
    return balance
  }),

  getHistory: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.sub

    const { data: pointHistory } = await strapiApi.get<StrapiGetPointsPopulatedRes>(
      `/points?filters[userId][$eq]=${userId}&sort=createdAt:desc&populate=*`
    )

    return pointHistory.data
  }),

  getFundPerks: publicProcedure
    .input(z.object({ fundSlug: z.enum(fundSlugs) }))
    .query(async ({ input }) => {
      const {
        data: { data: perks },
      } = await strapiApi.get<StrapiGetPerksPopulatedRes>('/perks?populate[images][fields]=formats')

      // Filter out whitelisted perks
      const perksFiltered = perks.filter((perk) =>
        perk.fundSlugWhitelist ? perk.fundSlugWhitelist.split(',').includes(input.fundSlug) : true
      )

      return perksFiltered
    }),

  getPrintfulProductVariants: protectedProcedure
    .input(z.object({ printfulProductId: z.string().min(1) }))
    .query(async ({ input }) => {
      const {
        data: { result: printfulProduct },
      } = await printfulApi.get<PrintfulGetProductRes>(`/store/products/${input.printfulProductId}`)

      return printfulProduct.sync_variants
    }),

  getCountries: publicProcedure.query(async () => {
    const {
      data: { result: countries },
    } = await printfulApi.get<PrintfulGetCountriesRes>('/countries')

    return countries
  }),

  estimatePrintfulOrderCosts: protectedProcedure
    .input(
      z.object({
        printfulSyncVariantId: z.number(),
        shipping: z.object({
          addressLine1: z.string().min(1),
          addressLine2: z.string().optional(),
          city: z.string().min(1),
          stateCode: z.string().min(1),
          countryCode: z.string().min(1),
          zip: z.string().min(1),
          phone: z.string().min(1),
          taxNumber: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await authenticateKeycloakClient()

      const userId = ctx.session.user.sub
      const user = await keycloak.users.findOne({ id: userId })

      if (!user || !user.id || !user.email)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'USER_NOT_FOUND',
        })

      const costEstimate = await estimatePrintfulOrderCost({
        shipping: input.shipping,
        email: user.email,
        name: user.attributes?.name?.[0],
        printfulSyncVariantId: input.printfulSyncVariantId,
      })

      return {
        product: Math.ceil(costEstimate.costs.subtotal / POINTS_REDEEM_PRICE_USD),
        shipping: Math.ceil(costEstimate.costs.shipping / POINTS_REDEEM_PRICE_USD),
        tax: Math.ceil((costEstimate.costs.tax + costEstimate.costs.vat) / POINTS_REDEEM_PRICE_USD),
        total: Math.ceil(costEstimate.costs.total / POINTS_REDEEM_PRICE_USD),
      }
    }),

  purchasePerk: protectedProcedure
    .input(
      z.object({
        perkId: z.string(),
        perkPrintfulSyncVariantId: z.number().optional(),
        fundSlug: z.enum(fundSlugs),
        shipping: z
          .object({
            addressLine1: z.string().min(1),
            addressLine2: z.string().optional(),
            city: z.string().min(1),
            stateCode: z.string().min(1),
            countryCode: z.string().min(1),
            zip: z.string().min(1),
            phone: z.string().min(1),
            taxNumber: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await authenticateKeycloakClient()
      const userId = ctx.session.user.sub

      const user = await keycloak.users.findOne({ id: userId })

      if (!user || !user.id || !user.email)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'USER_NOT_FOUND',
        })

      const {
        data: { data: perk },
      } = await strapiApi.get<StrapiGetPerkRes>(`/perks/${input.perkId}`)

      if (!perk) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Perk not found.' })

      // Check if shipping data is present if required
      if (perk.needsShippingAddress && !input.shipping) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shipping data is missing.' })
      }

      // Check if perk is available in the fund
      if (perk.fundSlugWhitelist && !perk.fundSlugWhitelist.split(',').includes(input.fundSlug)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Perk not available in this fund.' })
      }

      // Check if user has enough balance
      let deductionAmount = 0

      if (perk.printfulProductId && input.perkPrintfulSyncVariantId) {
        const printfulCostEstimate = await estimatePrintfulOrderCost({
          shipping: input.shipping!,
          email: user.email,
          name: user.attributes?.name?.[0],
          printfulSyncVariantId: input.perkPrintfulSyncVariantId,
        })

        deductionAmount = Math.ceil(printfulCostEstimate.costs.total / POINTS_REDEEM_PRICE_USD)
      } else {
        deductionAmount = perk.price
      }

      const currentBalance = await getPointsBalance(userId)
      const balanceAfterPurchase = currentBalance - deductionAmount

      if (balanceAfterPurchase < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance.' })
      }

      const purchaseJob = await perkPurchaseQueue.add('purchase', {
        perk,
        perkPrintfulSyncVariantId: input.perkPrintfulSyncVariantId,
        shipping: input.shipping,
        userId: user.id,
        userEmail: user.email,
        userFullname: user?.attributes?.name?.[0],
      })

      await purchaseJob.waitUntilFinished(
        new QueueEvents('PerkPurchase', { connection: redisConnection })
      )
    }),
})
