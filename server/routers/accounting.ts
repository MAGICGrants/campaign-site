import { z } from 'zod'
import { DonationSource, Prisma } from '@prisma/client'
import { publicProcedure, router } from '../trpc'
import { prisma } from '../services'

const donationSourceSchema = z.enum(['btcpayserver', 'coinbase', 'stripe'])

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
})
