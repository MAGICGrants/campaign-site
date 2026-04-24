import { z } from 'zod'

import { ADMIN_DATE_RANGE_MAX_DAYS } from '../../utils/adminDateRange'
import { DonationSource, FundSlug, Prisma } from '@prisma/client'
import Stripe from 'stripe'

import { accountingProcedure, router } from '../trpc'
import { prisma, stripe } from '../services'
import { accountingGenerationQueue } from '../queues'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from '../utils/btcpayserver'
import { getDeposits, getClosedSellOrders } from '../utils/kraken'
import type { BtcPayPaymentItem, DonationCryptoPayments, StripeInvoiceItem } from '../types'
import type { AccountingFundAccess } from '../utils/accounting-access'
import {
  assertFundSlugAllowed,
  btcpayFundAllowed,
  prismaDonationAccountingFundCondition,
  stripeFundSlugsForQuery,
} from '../utils/accounting-access'
import { balanceTransactionToUsd, fetchInvoiceBalanceTransaction } from '../utils/stripe-accounting'

const FUND_SLUGS: FundSlug[] = ['monero', 'firo', 'privacyguides', 'general']

async function deleteAccountingRecordsFromIgnoredId(
  type: 'deposit' | 'order',
  value: string
): Promise<number> {
  const affected =
    type === 'deposit'
      ? await prisma.$queryRaw<{ id: string; paymentReceivedAt: Date }[]>`
          SELECT id, "paymentReceivedAt"
          FROM "DonationAccounting"
          WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements("krakenDeposits"::jsonb) AS elem
            WHERE elem->>'txid' = ${value}
          )
        `
      : await prisma.$queryRaw<{ id: string; paymentReceivedAt: Date }[]>`
          SELECT id, "paymentReceivedAt"
          FROM "DonationAccounting"
          WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements("krakenOrders"::jsonb) AS elem
            WHERE elem->>'orderId' = ${value}
          )
        `

  if (affected.length === 0) {
    return 0
  }

  const minDate = new Date(Math.min(...affected.map((r) => r.paymentReceivedAt.getTime())))

  const result = await prisma.donationAccounting.deleteMany({
    where: { paymentReceivedAt: { gte: minDate } },
  })
  return result.count
}

const donationSourceSchema = z.enum(['btcpayserver', 'coinbase', 'stripe'])

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Local calendar dates; end is inclusive (we use endExclusive = day after dateTo at 00:00). */
export function localDateRangeBounds(dateFrom: string, dateTo: string) {
  const [y1, m1, d1] = dateFrom.split('-').map(Number)
  const [y2, m2, d2] = dateTo.split('-').map(Number)
  const start = new Date(y1, m1 - 1, d1)
  const endExclusive = new Date(y2, m2 - 1, d2 + 1)
  return {
    start,
    endExclusive,
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(endExclusive.getTime() / 1000),
  }
}

const adminDateRangeSchema = z
  .object({
    dateFrom: isoDateString,
    dateTo: isoDateString,
  })
  .refine((v) => v.dateFrom <= v.dateTo, { message: 'dateFrom must be <= dateTo' })
  .refine(
    (v) => {
      const { start, endExclusive } = localDateRangeBounds(v.dateFrom, v.dateTo)
      const spanDays = (endExclusive.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
      // Matches `differenceInCalendarDays(to, from) <= ADMIN_DATE_RANGE_MAX_DAYS` (spanDays = diff + 1).
      return spanDays <= ADMIN_DATE_RANGE_MAX_DAYS + 1
    },
    { message: `Date range cannot exceed ${ADMIN_DATE_RANGE_MAX_DAYS} days` }
  )

const AMOUNT_TOLERANCE = 1e-6

function findFundingApiRate(
  donations: { cryptoPayments: unknown }[],
  cryptoCode: string,
  paymentAmount: number,
  paymentId: string
): string | null {
  const paymentsList = (d: { cryptoPayments: unknown }) =>
    d.cryptoPayments as DonationCryptoPayments | null
  // First pass: match by payment id (txId)
  for (const donation of donations) {
    const payments = paymentsList(donation)
    if (!payments) continue
    for (const cp of payments) {
      if (cp.cryptoCode !== cryptoCode) continue
      if (cp.txId && cp.txId === paymentId) return cp.rate
    }
  }
  // Fall back: match by amount
  for (const donation of donations) {
    const payments = paymentsList(donation)
    if (!payments) continue
    for (const cp of payments) {
      if (cp.cryptoCode !== cryptoCode) continue
      if (Math.abs(Number(cp.grossAmount) - paymentAmount) < AMOUNT_TOLERANCE) {
        return cp.rate
      }
    }
  }
  return null
}

export const accountingRouter = router({
  listByDateRange: accountingProcedure
    .input(
      adminDateRangeSchema.extend({
        projectSlug: z.string().optional(),
        fundSlug: z.string().optional(),
        sources: z.array(donationSourceSchema).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const accountingAccess = (ctx as { accountingAccess: AccountingFundAccess }).accountingAccess
      assertFundSlugAllowed(accountingAccess, input.fundSlug)

      const { start: rangeStart, endExclusive } = localDateRangeBounds(
        input.dateFrom,
        input.dateTo
      )

      const sourcesToQuery: DonationSource[] =
        !input.sources || input.sources.length === 0
          ? ['btcpayserver', 'coinbase', 'stripe']
          : input.sources

      const where: Prisma.DonationAccountingWhereInput = {
        paymentReceivedAt: { gte: rangeStart, lt: endExclusive },
        source: { in: sourcesToQuery },
      }
      if (input.projectSlug) {
        where.projectSlug = input.projectSlug === '__unknown__' ? null : input.projectSlug
      }
      if (input.fundSlug) {
        where.fundSlug = input.fundSlug === '__unknown__' ? null : (input.fundSlug as FundSlug)
      } else {
        Object.assign(where, prismaDonationAccountingFundCondition(accountingAccess))
      }

      const dbRecords = await prisma.donationAccounting.findMany({
        where,
        orderBy: { paymentReceivedAt: 'asc' },
      })

      return dbRecords.map((r) => ({
        id: r.id,
        paymentReceivedAt: r.paymentReceivedAt,
        source: r.source,
        fundSlug: r.fundSlug,
        projectSlug: r.projectSlug,
        projectName: r.projectName,
        invoiceId: r.invoiceId,
        cryptoAmount: r.cryptoAmount,
        cryptoCode: r.cryptoCode,
        rate: r.rate,
        fiatAmount: r.fiatAmount,
        fee:
          r.source === 'coinbase' || r.source === 'stripe'
            ? r.fiatProcessorFee ?? null
            : null,
        cryptoProcessorFee: r.source === 'coinbase' ? r.cryptoProcessorFee ?? null : null,
        krakenDeposits: r.krakenDeposits,
        krakenOrders: r.krakenOrders,
        totalRealizedUsd: r.totalRealizedUsd,
      }))
    }),

  listAvailableProjects: accountingProcedure.query(async ({ ctx }) => {
    const accountingAccess = (ctx as { accountingAccess: AccountingFundAccess }).accountingAccess
    const records = await prisma.donationAccounting.findMany({
      where: prismaDonationAccountingFundCondition(accountingAccess),
      select: { projectSlug: true, projectName: true },
      distinct: ['projectSlug'],
      orderBy: { projectName: 'asc' },
    })
    const hasUnknown = records.some((r) => r.projectSlug == null)
    const projects = records
      .filter((r) => r.projectSlug != null)
      .map((r) => ({ projectSlug: r.projectSlug!, projectName: r.projectName ?? 'Unknown' }))
    if (hasUnknown) {
      projects.push({ projectSlug: '__unknown__', projectName: 'Unknown' })
    }
    return projects
  }),

  listAvailableMonths: accountingProcedure.query(async ({ ctx }) => {
    const accountingAccess = (ctx as { accountingAccess: AccountingFundAccess }).accountingAccess
    const records = await prisma.donationAccounting.findMany({
      where: prismaDonationAccountingFundCondition(accountingAccess),
      select: { paymentReceivedAt: true },
      orderBy: { paymentReceivedAt: 'asc' },
    })

    const months = new Map<string, { year: number; month: number }>()
    for (const r of records) {
      const d = r.paymentReceivedAt
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!months.has(key)) {
        months.set(key, { year: d.getFullYear(), month: d.getMonth() + 1 })
      }
    }

    return Array.from(months.values()).sort((a, b) => a.year - b.year || a.month - b.month)
  }),

  listBtcPayPaymentsByDateRange: accountingProcedure
    .input(adminDateRangeSchema)
    .query(async ({ ctx, input }): Promise<BtcPayPaymentItem[]> => {
      const accountingAccess = (ctx as { accountingAccess: AccountingFundAccess }).accountingAccess
      const { startTs, endTs } = localDateRangeBounds(input.dateFrom, input.dateTo)
      const invoices = await getBtcPayInvoices({
        startDate: startTs,
        endDate: endTs,
      })
      const items: BtcPayPaymentItem[] = []

      const fundingApiInvoiceIds = invoices
        .filter(
          (inv) =>
            (inv.metadata as { staticGeneratedForApi?: string })?.staticGeneratedForApi === 'true'
        )
        .map((inv) => inv.id)

      const fundingDonations =
        fundingApiInvoiceIds.length > 0
          ? await prisma.donation.findMany({
              where: { btcPayInvoiceId: { in: fundingApiInvoiceIds } },
              select: { btcPayInvoiceId: true, cryptoPayments: true },
            })
          : []

      const fundingDonationsByInvoice = new Map<string, typeof fundingDonations>()
      for (const d of fundingDonations) {
        if (!d.btcPayInvoiceId) continue
        const group = fundingDonationsByInvoice.get(d.btcPayInvoiceId) || []
        group.push(d)
        fundingDonationsByInvoice.set(d.btcPayInvoiceId, group)
      }

      for (const invoice of invoices) {
        const meta = invoice.metadata as
          | {
              fundSlug?: string
              projectSlug?: string
              projectName?: string
              staticGeneratedForApi?: string
            }
          | undefined
        if (!meta?.fundSlug) continue

        const staticAddress = meta.staticGeneratedForApi === 'true'

        let paymentMethods
        try {
          paymentMethods = await getBtcPayInvoicePaymentMethods(invoice.id)
        } catch {
          continue
        }

        for (const pm of paymentMethods) {
          const cryptoCode = pm.currency
          if (!['BTC', 'LTC', 'XMR'].includes(cryptoCode)) continue

          for (const payment of pm.payments) {
            if (payment.status !== 'Settled') continue
            const cryptoAmount = Number(payment.value)
            if (cryptoAmount <= 0) continue

            let rate: string
            if (staticAddress) {
              rate =
                findFundingApiRate(
                  fundingDonationsByInvoice.get(invoice.id) || [],
                  cryptoCode,
                  cryptoAmount,
                  payment.id
                ) ?? pm.rate
            } else {
              rate = pm.rate
            }
            const fiatAmount = Number((cryptoAmount * Number(rate)).toFixed(2))

            items.push({
              paymentId: payment.id,
              invoiceId: invoice.id,
              receivedAt: new Date(payment.receivedDate * 1000),
              cryptoCode,
              cryptoAmount,
              cryptoAmountRaw: payment.value,
              rate,
              fiatAmount,
              projectSlug: meta.projectSlug ?? 'general',
              projectName: meta.projectName ?? 'General',
              fundSlug: meta.fundSlug,
              isStaticGenerated: staticAddress,
            })
          }
        }
      }

      items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      return items.filter((item) => btcpayFundAllowed(accountingAccess, item.fundSlug))
    }),

  listKrakenDepositsByDateRange: accountingProcedure
    .input(adminDateRangeSchema)
    .query(async ({ input }) => {
      const { start, endExclusive } = localDateRangeBounds(input.dateFrom, input.dateTo)
      const allDeposits = await getDeposits(start)
      return allDeposits.filter((d) => d.time >= start && d.time < endExclusive)
    }),

  listKrakenSellOrdersByDateRange: accountingProcedure
    .input(adminDateRangeSchema)
    .query(async ({ input }) => {
      const { start, endExclusive } = localDateRangeBounds(input.dateFrom, input.dateTo)
      const allOrders = await getClosedSellOrders(start)
      return allOrders.filter((o) => o.closedAt >= start && o.closedAt < endExclusive)
    }),

  listStripeInvoicesByDateRange: accountingProcedure
    .input(adminDateRangeSchema)
    .query(async ({ ctx, input }): Promise<StripeInvoiceItem[]> => {
      const accountingAccess = (ctx as { accountingAccess: AccountingFundAccess }).accountingAccess
      const { startTs, endTs } = localDateRangeBounds(input.dateFrom, input.dateTo)

      const items: StripeInvoiceItem[] = []

      const stripeFundsForInvoices = stripeFundSlugsForQuery(accountingAccess, undefined)
      const stripeResults = await Promise.allSettled(
        stripeFundsForInvoices.map(async (fundSlug) => {
          const stripeClient = stripe[fundSlug]
          if (!stripeClient) return []
          const fundItems: StripeInvoiceItem[] = []
          const invoices: Stripe.Invoice[] = []
          for await (const inv of stripeClient.invoices.list({
            created: { gte: startTs, lt: endTs },
            status: 'paid',
            limit: 100,
            expand: [
              'data.parent',
              'data.payments.data.payment',
            ],
          })) {
            const meta =
              (inv.parent?.subscription_details as { metadata?: Record<string, string> } | null)
                ?.metadata ?? (inv.metadata as Record<string, string> | null)
            if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
            invoices.push(inv)
          }
          const btResults = await Promise.all(
            invoices.map((inv) => fetchInvoiceBalanceTransaction(inv, stripeClient))
          )
          for (let i = 0; i < invoices.length; i++) {
            const inv = invoices[i]
            const meta =
              (inv.parent?.subscription_details as { metadata?: Record<string, string> } | null)
                ?.metadata ?? (inv.metadata as Record<string, string> | null)
            if (!meta) continue
            const grossCents = inv.amount_paid ?? inv.total ?? 0
            const grossFiatAmount = grossCents / 100
            const { balanceTransaction: btObj, paymentId } = btResults[i]
            const { fee, net: netFiatAmount } = btObj
              ? balanceTransactionToUsd(btObj, grossCents)
              : { fee: 0, net: grossFiatAmount }
            fundItems.push({
              id: inv.id,
              createdAt: new Date(inv.created * 1000),
              paymentId,
              invoiceId: inv.id,
              projectSlug: meta.projectSlug,
              projectName: meta.projectName ?? 'General',
              fundSlug: meta.fundSlug as FundSlug,
              grossFiatAmount,
              fee,
              netFiatAmount,
              isRecurring: !!inv.parent?.subscription_details,
            })
          }
          const paymentIntents = await stripeClient.paymentIntents.list({
            created: { gte: startTs, lt: endTs },
            limit: 100,
            expand: ['data.latest_charge.balance_transaction'],
          })
          for (const pi of paymentIntents.data) {
            if (pi.status !== 'succeeded' || !pi.amount_received || pi.amount_received <= 0)
              continue
            const meta = pi.metadata as Record<string, string> | null
            if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
            if (meta.isSubscription === 'true') continue
            const grossCents = pi.amount_received
            const grossFiatAmount = grossCents / 100
            const charge = pi.latest_charge
            const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null
            const btObj = bt && typeof bt === 'object' ? bt : null
            const { fee, net: netFiatAmount } = btObj
              ? balanceTransactionToUsd(btObj, grossCents)
              : { fee: 0, net: grossFiatAmount }
            fundItems.push({
              id: pi.id,
              createdAt: new Date(pi.created * 1000),
              paymentId: pi.id,
              invoiceId: null,
              projectSlug: meta.projectSlug,
              projectName: meta.projectName ?? 'General',
              fundSlug: meta.fundSlug as FundSlug,
              grossFiatAmount,
              fee,
              netFiatAmount,
              isRecurring: false,
            })
          }
          return fundItems
        })
      )
      for (let i = 0; i < stripeResults.length; i++) {
        const result = stripeResults[i]
        if (result.status === 'fulfilled') {
          items.push(...result.value)
        } else {
          console.error(`[Stripe] Failed to fetch from ${stripeFundsForInvoices[i]}:`, result.reason)
        }
      }

      items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      return items
    }),

  listAccountingIgnores: accountingProcedure.query(async () => {
    const records = await prisma.accountingIgnore.findMany({
      orderBy: [{ type: 'asc' }, { value: 'asc' }],
    })
    return {
      deposits: records
        .filter((r) => r.type === 'deposit')
        .map((r) => ({ id: r.id, value: r.value })),
      orders: records.filter((r) => r.type === 'order').map((r) => ({ id: r.id, value: r.value })),
    }
  }),

  addAccountingIgnore: accountingProcedure
    .input(
      z.object({
        type: z.enum(['deposit', 'order']),
        value: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const value = input.value.trim()
      const record = await prisma.accountingIgnore.upsert({
        where: { type_value: { type: input.type, value } },
        create: { type: input.type, value },
        update: {},
      })
      const deleted = await deleteAccountingRecordsFromIgnoredId(input.type, value)
      await accountingGenerationQueue.add('AccountingGeneration', {})
      return { ...record, deletedCount: deleted }
    }),

  removeAccountingIgnore: accountingProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.accountingIgnore.delete({ where: { id: input.id } })
      // When un-ignoring, no records contain this id (it was excluded). Delete all
      // so regeneration recreates with the newly included deposit/order.
      const result = await prisma.donationAccounting.deleteMany({})
      await accountingGenerationQueue.add('AccountingGeneration', {})
      return { deletedCount: result.count }
    }),
})
