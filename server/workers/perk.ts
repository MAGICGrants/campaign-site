import { Worker } from 'bullmq'
import { AxiosResponse } from 'axios'
import { TRPCError } from '@trpc/server'

import { redisConnection as connection } from '../../config/redis'
import {
  cancelPrintfulOrder,
  createPrintfulOrder,
  createStrapiOrder,
  deductPointsFromUser,
  deleteStrapiOrder,
  estimatePrintfulOrderCost,
  getPointsBalance,
} from '../utils/perks'
import { POINTS_REDEEM_PRICE_USD } from '../../config'
import {
  PrintfulCreateOrderReq,
  PrintfulCreateOrderRes,
  StrapiCreateOrderBody,
  StrapiCreateOrderRes,
  StrapiCreatePointBody,
  StrapiOrder,
  StrapiPerk,
} from '../types'
import { printfulApi, strapiApi } from '../services'
import { sendPerkPurchaseConfirmationEmail } from '../utils/mailing'
import { log } from '../../utils/logging'

export type PerkPurchaseWorkerData = {
  perk: StrapiPerk
  perkPrintfulSyncVariantId?: number
  shipping?: {
    addressLine1: string
    addressLine2?: string
    city: string
    stateCode: string
    countryCode: string
    zip: string
    phone: string
    taxNumber?: string
  }
  userId: string
  userEmail: string
  userFullname: string
}

const globalForWorker = global as unknown as { hasInitializedWorkers: boolean }

if (!globalForWorker.hasInitializedWorkers)
  new Worker<PerkPurchaseWorkerData>(
    'PerkPurchase',
    async (job) => {
      // Check if user has enough balance
      let deductionAmount = 0

      if (
        job.data.perk.printfulProductId &&
        job.data.perkPrintfulSyncVariantId &&
        job.data.shipping
      ) {
        const printfulCostEstimate = await estimatePrintfulOrderCost({
          shipping: job.data.shipping,
          name: job.data.userFullname,
          email: job.data.userEmail,
          printfulSyncVariantId: job.data.perkPrintfulSyncVariantId,
        })

        deductionAmount = Math.ceil(printfulCostEstimate.costs.total / POINTS_REDEEM_PRICE_USD)
      } else {
        deductionAmount = job.data.perk.price
      }

      const currentBalance = await getPointsBalance(job.data.userId)
      const balanceAfterPurchase = currentBalance - deductionAmount

      if (balanceAfterPurchase < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient balance.' })
      }

      let printfulOrder: PrintfulCreateOrderRes | null = null

      // Create printful order (if applicable)
      if (
        job.data.perk.printfulProductId &&
        job.data.perkPrintfulSyncVariantId &&
        job.data.shipping
      ) {
        try {
          printfulOrder = await createPrintfulOrder({
            shipping: job.data.shipping,
            name: job.data.userFullname,
            email: job.data.userEmail,
            printfulSyncVariantId: job.data.perkPrintfulSyncVariantId,
          })
        } catch (error) {
          log('error', `[Perk purchase worker] Failed to create Printful order.`)
          throw error
        }
      }

      let strapiOrder: StrapiOrder | null = null

      // Create strapi order
      try {
        strapiOrder = await createStrapiOrder({
          perkId: job.data.perk.documentId,
          userId: job.data.userId,
          userEmail: job.data.userEmail,
          shipping: job.data.shipping,
        })
      } catch (error) {
        log('error', `[Perk purchase worker] Failed to create Strapi order. Rolling back.`)
        await cancelPrintfulOrder(printfulOrder?.externalId!)
        throw error
      }

      try {
        // Deduct points
        await deductPointsFromUser({
          deductionAmount,
          orderId: strapiOrder.documentId,
          perkId: job.data.perk.documentId,
          userId: job.data.userId,
        })
      } catch (error) {
        log('error', `[Perk purchase worker] Failed to deduct points. Rolling back.`)
        if (printfulOrder) await cancelPrintfulOrder(printfulOrder.externalId)
        await deleteStrapiOrder(strapiOrder.documentId)
        throw error
      }

      try {
        sendPerkPurchaseConfirmationEmail({
          to: job.data.userEmail,
          perkName: job.data.perk.name,
          pointsRedeemed: deductionAmount,
          address: job.data.shipping,
        })
      } catch (error) {
        log(
          'error',
          `[Perk purchase worker] Failed to send puchase confirmation email. NOT rolling back.`
        )
        throw error
      }

      log(
        'info',
        `[Perk purchase worker] Successfully processed perk purchase! Order ID: ${strapiOrder.documentId}`
      )
    },
    { connection, concurrency: 1 }
  )

if (process.env.NODE_ENV !== 'production') globalForWorker.hasInitializedWorkers = true
