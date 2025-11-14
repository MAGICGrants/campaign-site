import { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { env } from '../../env.mjs'
import { prisma } from '../../server/services'
import { fundSlugs } from '../../utils/funds'
import { FundSlug } from '@prisma/client'
import dayjs from 'dayjs'

const querySchema = z.object({ fund: z.enum(fundSlugs) })

type ResponseBody = { fund: FundSlug; members_count: number }

const cachedResponses: Record<string, { data: ResponseBody; expiresAt: Date } | undefined> = {}

async function handle(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  let query: z.infer<typeof querySchema> = {} as z.infer<typeof querySchema>

  try {
    query = await querySchema.parseAsync(req.query)
  } catch (error) {
    res.status(400).json(error)
  }

  const cacheKey = query.fund
  const cachedResponse = cachedResponses[cacheKey]
  if (cachedResponse && cachedResponse.expiresAt > new Date()) {
    return res.send(cachedResponse.data)
  }

  const activeMembers = await prisma.donation.groupBy({
    by: ['userId'],
    where: { fundSlug: query.fund, membershipExpiresAt: { gt: new Date() } },
  })

  const response = { fund: query.fund, members_count: activeMembers.length }
  cachedResponses[cacheKey] = {
    data: response,
    expiresAt: dayjs().add(10, 'minutes').toDate(),
  }

  return res.json(response)
}

export default handle
