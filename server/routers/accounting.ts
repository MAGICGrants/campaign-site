import { z } from 'zod'
import { DonationSource, FundSlug, Prisma } from '@prisma/client'
import { adminProcedure, router } from '../trpc'
import { prisma, stripe } from '../services'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from '../utils/btcpayserver'
import { getDeposits, getClosedSellOrders } from '../utils/kraken'
import type { BtcPayPaymentItem, StripeInvoiceItem } from '../types'

const FUND_SLUGS: FundSlug[] = ['monero', 'firo', 'privacyguides', 'general']

function balanceTransactionToUsd(
  bt: { currency: string; fee?: number; net?: number; exchange_rate?: number | null },
  grossCents: number
): { fee: number; net: number } {
  if (!bt) return { fee: 0, net: grossCents / 100 }
  const feeInt = bt.fee ?? 0
  const netInt = bt.net ?? grossCents
  const currency = (bt.currency ?? 'usd').toLowerCase()
  const rate = currency === 'usd' ? 1 : (bt.exchange_rate ?? 0)
  if (rate <= 0 && currency !== 'usd') return { fee: 0, net: grossCents / 100 }
  return {
    fee: feeInt / rate / 100,
    net: netInt / rate / 100,
  }
}

const donationSourceSchema = z.enum(['btcpayserver', 'coinbase', 'stripe'])

const AMOUNT_TOLERANCE = 1e-6

function findFundingApiRate(
  donations: { cryptoPayments: unknown }[],
  cryptoCode: string,
  paymentAmount: number
): string | null {
  for (const donation of donations) {
    const payments = donation.cryptoPayments as
      | { cryptoCode: string; grossAmount: string; rate: string }[]
      | null
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
  listByMonth: adminProcedure
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        projectSlug: z.string().optional(),
        fundSlug: z.string().optional(),
        sources: z.array(donationSourceSchema).optional(),
      })
    )
    .query(async ({ input }) => {
      const startOfMonth = new Date(input.year, input.month - 1, 1)
      const startOfNextMonth = new Date(input.year, input.month, 1)
      const startTs = Math.floor(startOfMonth.getTime() / 1000)
      const endTs = Math.floor(startOfNextMonth.getTime() / 1000)

      const includeStripe =
        !input.sources || input.sources.length === 0 || input.sources.includes('stripe')
      const dbSources: DonationSource[] =
        input.sources && input.sources.length > 0
          ? input.sources.filter((s): s is DonationSource => s !== 'stripe')
          : ['btcpayserver', 'coinbase']

      const records: {
        id: string
        paymentReceivedAt: Date
        source: DonationSource
        fundSlug: FundSlug
        projectSlug: string
        projectName: string
        invoiceId: string
        cryptoAmount: string
        cryptoCode: string
        rate: string
        fiatAmount: number
        fee: number | null
        krakenDeposits: unknown
        krakenOrders: unknown
        totalRealizedUsd: number
      }[] = []

      if (dbSources.length > 0) {
        const where: Prisma.DonationAccountingWhereInput = {
          paymentReceivedAt: { gte: startOfMonth, lt: startOfNextMonth },
          source: { in: dbSources },
        }
        if (input.projectSlug) where.projectSlug = input.projectSlug
        if (input.fundSlug) where.fundSlug = input.fundSlug as FundSlug

        const dbRecords = await prisma.donationAccounting.findMany({
          where,
          orderBy: { paymentReceivedAt: 'asc' },
        })
        records.push(
          ...dbRecords.map((r) => ({
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
            fee: null as number | null,
            krakenDeposits: r.krakenDeposits,
            krakenOrders: r.krakenOrders,
            totalRealizedUsd: r.totalRealizedUsd,
          }))
        )
      }

      if (includeStripe) {
        for (const fundSlug of FUND_SLUGS) {
          if (input.fundSlug && input.fundSlug !== fundSlug) continue
          const stripeClient = stripe[fundSlug]
          if (!stripeClient) continue

          try {
            for await (const inv of stripeClient.invoices.list({
              created: { gte: startTs, lt: endTs },
              status: 'paid',
              limit: 100,
              expand: ['data.subscription_details', 'data.charge.balance_transaction'],
            })) {
              const meta =
                (inv.subscription_details as { metadata?: Record<string, string> } | null)
                  ?.metadata ?? (inv.metadata as Record<string, string> | null)
              if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
              if (input.projectSlug && input.projectSlug !== meta.projectSlug) continue

              const grossCents = inv.amount_paid ?? inv.total ?? 0
              const grossFiatAmount = grossCents / 100
              const bt =
                inv.charge && typeof inv.charge === 'object' ? inv.charge.balance_transaction : null
              const btObj = bt && typeof bt === 'object' ? bt : null
              const { fee, net: netFiatAmount } = btObj
                ? balanceTransactionToUsd(btObj, grossCents)
                : { fee: 0, net: grossFiatAmount }

              records.push({
                id: `stripe-inv-${inv.id}`,
                paymentReceivedAt: new Date(inv.created * 1000),
                source: 'stripe' as DonationSource,
                fundSlug: meta.fundSlug as FundSlug,
                projectSlug: meta.projectSlug,
                projectName: meta.projectName ?? 'General',
                invoiceId: inv.id,
                cryptoAmount: '-',
                cryptoCode: 'USD',
                rate: '1',
                fiatAmount: grossFiatAmount,
                fee,
                krakenDeposits: null,
                krakenOrders: null,
                totalRealizedUsd: netFiatAmount,
              })
            }

            for await (const pi of stripeClient.paymentIntents.list({
              created: { gte: startTs, lt: endTs },
              limit: 100,
              expand: ['data.latest_charge.balance_transaction'],
            })) {
              if (pi.status !== 'succeeded' || !pi.amount_received || pi.amount_received <= 0)
                continue
              const meta = pi.metadata as Record<string, string> | null
              if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
              if (meta.isSubscription === 'true') continue
              if (input.projectSlug && input.projectSlug !== meta.projectSlug) continue

              const grossCents = pi.amount_received
              const grossFiatAmount = grossCents / 100
              const charge = pi.latest_charge
              const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null
              const btObj = bt && typeof bt === 'object' ? bt : null
              const { fee, net: netFiatAmount } = btObj
                ? balanceTransactionToUsd(btObj, grossCents)
                : { fee: 0, net: grossFiatAmount }

              records.push({
                id: `stripe-pi-${pi.id}`,
                paymentReceivedAt: new Date(pi.created * 1000),
                source: 'stripe' as DonationSource,
                fundSlug: meta.fundSlug as FundSlug,
                projectSlug: meta.projectSlug,
                projectName: meta.projectName ?? 'General',
                invoiceId: pi.id,
                cryptoAmount: '-',
                cryptoCode: 'USD',
                rate: '1',
                fiatAmount: grossFiatAmount,
                fee,
                krakenDeposits: null,
                krakenOrders: null,
                totalRealizedUsd: netFiatAmount,
              })
            }
          } catch (err) {
            console.error(`[Stripe] Failed to fetch from ${fundSlug}:`, err)
          }
        }
      }

      records.sort((a, b) => a.paymentReceivedAt.getTime() - b.paymentReceivedAt.getTime())
      return records
    }),

  listAvailableProjects: adminProcedure.query(async () => {
    const records = await prisma.donationAccounting.findMany({
      select: { projectSlug: true, projectName: true },
      distinct: ['projectSlug'],
      orderBy: { projectName: 'asc' },
    })
    return records.map((r) => ({ projectSlug: r.projectSlug, projectName: r.projectName }))
  }),

  listAvailableMonths: adminProcedure.query(async () => {
    const records = await prisma.donationAccounting.findMany({
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

  listBtcPayPaymentsByMonth: adminProcedure
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      })
    )
    .query(async ({ input }): Promise<BtcPayPaymentItem[]> => {
      const startOfMonth = new Date(input.year, input.month - 1, 1)
      const startOfNextMonth = new Date(input.year, input.month, 1)
      const invoices = await getBtcPayInvoices({
        startDate: Math.floor(startOfMonth.getTime() / 1000),
        endDate: Math.floor(startOfNextMonth.getTime() / 1000),
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
                  cryptoAmount
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
      return items
    }),

  listKrakenDepositsByMonth: adminProcedure
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      })
    )
    .query(async ({ input }) => {
      const startOfMonth = new Date(input.year, input.month - 1, 1)
      const startOfNextMonth = new Date(input.year, input.month, 1)
      const allDeposits = await getDeposits(startOfMonth)
      return allDeposits.filter((d) => d.time >= startOfMonth && d.time < startOfNextMonth)
    }),

  listKrakenSellOrdersByMonth: adminProcedure
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      })
    )
    .query(async ({ input }) => {
      const startOfMonth = new Date(input.year, input.month - 1, 1)
      const startOfNextMonth = new Date(input.year, input.month, 1)
      const allOrders = await getClosedSellOrders(startOfMonth)
      return allOrders.filter((o) => o.closedAt >= startOfMonth && o.closedAt < startOfNextMonth)
    }),

  listStripeInvoicesByMonth: adminProcedure
    .input(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      })
    )
    .query(async ({ input }): Promise<StripeInvoiceItem[]> => {
      const startOfMonth = new Date(input.year, input.month - 1, 1)
      const startOfNextMonth = new Date(input.year, input.month, 1)
      const startTs = Math.floor(startOfMonth.getTime() / 1000)
      const endTs = Math.floor(startOfNextMonth.getTime() / 1000)

      const items: StripeInvoiceItem[] = []

      for (const fundSlug of FUND_SLUGS) {
        const stripeClient = stripe[fundSlug]
        if (!stripeClient) continue

        try {
          // Fetch paid invoices (recurring / subscription)
          for await (const inv of stripeClient.invoices.list({
            created: { gte: startTs, lt: endTs },
            status: 'paid',
            limit: 100,
            expand: ['data.subscription_details', 'data.charge.balance_transaction'],
          })) {
            const meta =
              (inv.subscription_details as { metadata?: Record<string, string> } | null)
                ?.metadata ?? (inv.metadata as Record<string, string> | null)
            if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
            const grossCents = inv.amount_paid ?? inv.total ?? 0
            const grossFiatAmount = grossCents / 100
            const bt =
              inv.charge && typeof inv.charge === 'object' ? inv.charge.balance_transaction : null
            const btObj = bt && typeof bt === 'object' ? bt : null
            const { fee, net: netFiatAmount } = btObj
              ? balanceTransactionToUsd(btObj, grossCents)
              : { fee: 0, net: grossFiatAmount }
            items.push({
              id: inv.id,
              createdAt: new Date(inv.created * 1000),
              paymentId:
                typeof inv.payment_intent === 'string'
                  ? inv.payment_intent
                  : (inv.payment_intent?.id ?? inv.id),
              invoiceId: inv.id,
              projectSlug: meta.projectSlug,
              projectName: meta.projectName ?? 'General',
              fundSlug: meta.fundSlug as FundSlug,
              grossFiatAmount,
              fee,
              netFiatAmount,
              isRecurring: !!inv.subscription,
            })
          }

          // Fetch succeeded payment intents (one-time)
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
            items.push({
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
        } catch (err) {
          console.error(`[Stripe] Failed to fetch from ${fundSlug}:`, err)
        }
      }

      items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      return items
    }),
})
