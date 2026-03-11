import { z } from 'zod'
import { DonationSource, Prisma } from '@prisma/client'
import { publicProcedure, router } from '../trpc'
import { prisma } from '../services'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from '../utils/btcpayserver'
import { getDeposits } from '../utils/kraken'
import type { BtcPayPaymentItem } from '../types'

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
  listByMonth: publicProcedure
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

      const where: Prisma.DonationAccountingWhereInput = {
        paymentReceivedAt: {
          gte: startOfMonth,
          lt: startOfNextMonth,
        },
      }

      if (input.projectSlug) {
        where.projectSlug = input.projectSlug
      }
      if (input.fundSlug) {
        where.fundSlug = input.fundSlug as any
      }
      if (input.sources && input.sources.length > 0) {
        where.source = { in: input.sources as DonationSource[] }
      }

      return prisma.donationAccounting.findMany({
        where,
        orderBy: { paymentReceivedAt: 'asc' },
      })
    }),

  listAvailableProjects: publicProcedure.query(async () => {
    const records = await prisma.donationAccounting.findMany({
      select: { projectSlug: true, projectName: true },
      distinct: ['projectSlug'],
      orderBy: { projectName: 'asc' },
    })
    return records.map((r) => ({ projectSlug: r.projectSlug, projectName: r.projectName }))
  }),

  listAvailableMonths: publicProcedure.query(async () => {
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

  listBtcPayPaymentsByMonth: publicProcedure
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

  listKrakenDepositsByMonth: publicProcedure
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
      return allDeposits.filter(
        (d) => d.time >= startOfMonth && d.time < startOfNextMonth
      )
    }),
})
