import { NextApiRequest, NextApiResponse } from 'next'
import { FundSlug } from '@prisma/client'
import { z } from 'zod'
import dayjs from 'dayjs'

import { getProjects } from '../../utils/md'
import { env } from '../../env.mjs'
import { btcpayApi, prisma } from '../../server/services'
import { CURRENCY } from '../../config'
import {
  BtcPayCreateInvoiceRes,
  BtcPayGetPaymentMethodsRes,
  BtcPayGetRatesRes,
  DonationMetadata,
} from '../../server/types'
import { fundSlugs } from '../../utils/funds'
import { ProjectItem } from '../../utils/types'

const ASSETS = ['BTC', 'XMR', 'LTC', 'USD'] as const
const CRYPTO_CURRENCIES = ['BTC', 'XMR', 'LTC'] as const

type Asset = (typeof ASSETS)[number]
type CryptoCurrency = (typeof CRYPTO_CURRENCIES)[number]

type ProjectAddresses = {
  btc: string | null
  xmr: string | null
  ltc: string | null
}

type ResponseBody = {
  title: string
  fund: FundSlug
  date: string
  author: string
  url: string
  is_funded: boolean
  raised_amount_percent: number
  contributions: number
  target_amount_btc: number
  target_amount_xmr: number
  target_amount_ltc: number
  target_amount_usd: number
  remaining_amount_btc: number
  remaining_amount_xmr: number
  remaining_amount_ltc: number
  remaining_amount_usd: number
  address_btc: string | null
  address_xmr: string | null
  address_ltc: string | null
}[]

type ResponseBodySpecificAsset = {
  title: string
  fund: FundSlug
  date: string
  author: string
  url: string
  is_funded: boolean
  raised_amount_percent: number
  contributions: number
  asset: Asset
  target_amount: number
  remaining_amount: number
  address: string | null
}[]

// The cache key should be: fund-asset-project_status
const cachedResponses: Record<
  string,
  { data: ResponseBody | ResponseBodySpecificAsset; expiresAt: Date } | undefined
> = {}

async function getProjectAddresses(project: ProjectItem): Promise<ProjectAddresses | null> {
  const existing = await prisma.projectAddresses.findUnique({
    where: { projectSlug_fundSlug: { projectSlug: project.slug, fundSlug: project.fund } },
  })

  if (!existing) return null

  return {
    btc: existing.bitcoinAddress,
    xmr: existing.moneroAddress,
    ltc: existing.litecoinAddress,
  }
}

function extractAddressesFromPaymentMethods(
  paymentMethods: BtcPayGetPaymentMethodsRes
): ProjectAddresses {
  const currencyToKey: Record<CryptoCurrency, keyof ProjectAddresses> = {
    BTC: 'btc',
    XMR: 'xmr',
    LTC: 'ltc',
  }

  const addresses: ProjectAddresses = { btc: null, xmr: null, ltc: null }

  paymentMethods.forEach((pm) => {
    const key = currencyToKey[pm.currency as CryptoCurrency]
    if (key) addresses[key] = pm.destination
  })

  if (process.env.NODE_ENV !== 'development') {
    const missing = CRYPTO_CURRENCIES.filter((c) => !addresses[currencyToKey[c]])
    if (missing.length > 0) {
      throw new Error(
        `[/api/funding-required] Could not get ${missing.join(', ')} address(es) from payment methods.`
      )
    }
  }

  return addresses
}

async function createProjectAddresses(project: ProjectItem): Promise<ProjectAddresses> {
  const metadata: DonationMetadata = {
    userId: null,
    donorName: null,
    donorNameIsProfane: 'false',
    donorEmail: null,
    projectSlug: project.slug,
    projectName: project.title,
    fundSlug: project.fund as FundSlug,
    isMembership: 'false',
    membershipTerm: null,
    isSubscription: 'false',
    isTaxDeductible: 'false',
    staticGeneratedForApi: 'true',
    givePointsBack: 'false',
    showDonorNameOnLeaderboard: 'false',
  }

  const { data: invoice } = await btcpayApi.post<BtcPayCreateInvoiceRes>('/invoices', {
    checkout: {
      monitoringMinutes: 9999999,
      lazyPaymentMethods: false,
    },
    currency: CURRENCY,
    metadata,
  })

  const { data: paymentMethods } = await btcpayApi.get<BtcPayGetPaymentMethodsRes>(
    `/invoices/${invoice.id}/payment-methods`
  )

  const addresses = extractAddressesFromPaymentMethods(paymentMethods)

  await prisma.projectAddresses.create({
    data: {
      projectSlug: project.slug,
      fundSlug: project.fund,
      btcPayInvoiceId: invoice.id,
      bitcoinAddress: addresses.btc,
      moneroAddress: addresses.xmr,
      litecoinAddress: addresses.ltc,
    },
  })

  return addresses
}

const querySchema = z.object({
  fund: z.enum(fundSlugs).optional(),
  asset: z.enum(ASSETS).optional(),
  project_status: z.enum(['FUNDED', 'NOT_FUNDED', 'ANY']).default('NOT_FUNDED'),
})

async function handle(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody | ResponseBodySpecificAsset>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const query = await querySchema.parseAsync(req.query)

  // Get response from cache
  const cacheKey = `${query.fund}-${query.asset}-${query.project_status}`
  const cachedResponse = cachedResponses[cacheKey]
  if (cachedResponse && cachedResponse.expiresAt > new Date()) {
    return res.send(cachedResponse.data)
  }

  const projects = (await getProjects(query.fund)).filter((project) =>
    query.project_status === 'FUNDED'
      ? project.isFunded
      : query.project_status === 'ANY'
        ? true
        : !project.isFunded
  )

  const rates: Record<string, number | undefined> = {}

  // Get exchange rates if target asset is not USD (or if there is no target asset)
  if (query.asset !== 'USD') {
    const assetsWithoutUsd = ASSETS.filter((asset) => asset !== 'USD')
    const params = assetsWithoutUsd.map((asset) => `currencyPair=${asset}_USD`).join('&')
    const { data: _rates } = await btcpayApi.get<BtcPayGetRatesRes>(`/rates?${params}`)

    _rates.forEach((rate) => {
      const asset = rate.currencyPair.split('_')[0] as string
      rates[asset] = Number(rate.rate)
    })
  }

  let responseBody: ResponseBody | ResponseBodySpecificAsset = await Promise.all(
    projects.map(async (project): Promise<ResponseBody[0]> => {
      const addresses: ProjectAddresses = project.isFunded
        ? { btc: null, xmr: null, ltc: null }
        : (await getProjectAddresses(project)) ?? (await createProjectAddresses(project))

      const targetAmountBtc = project.goal / (rates.BTC || 0)
      const targetAmountXmr = project.goal / (rates.XMR || 0)
      const targetAmountLtc = project.goal / (rates.LTC || 0)
      const targetAmountUsd = project.goal

      const allDonationsSumUsd =
        project.totalDonationsBTCInFiat +
        project.totalDonationsXMRInFiat +
        project.totalDonationsLTCInFiat +
        project.totalDonationsEVMInFiat +
        project.totalDonationsManual +
        project.totalDonationsFiat

      const remainingAmountBtc = (project.goal - allDonationsSumUsd) / (rates.BTC || 0)
      const remainingAmountXmr = (project.goal - allDonationsSumUsd) / (rates.XMR || 0)
      const remainingAmountLtc = (project.goal - allDonationsSumUsd) / (rates.LTC || 0)
      const remainingAmountUsd = project.goal - allDonationsSumUsd

      const contributions =
        project.numDonationsBTC +
        project.numDonationsXMR +
        project.numDonationsLTC +
        project.numDonationsEVM +
        project.numDonationsManual +
        project.numDonationsFiat

      return {
        title: project.title,
        fund: project.fund,
        date: project.date,
        author: project.nym,
        url: `${env.APP_URL}/${project.fund}/projects/${project.slug}`,
        is_funded: !!project.isFunded,
        target_amount_btc: Number(targetAmountBtc.toFixed(8)),
        target_amount_xmr: Number(targetAmountXmr.toFixed(12)),
        target_amount_ltc: Number(targetAmountLtc.toFixed(8)),
        target_amount_usd: Number(targetAmountUsd.toFixed(2)),
        remaining_amount_btc: Number((remainingAmountBtc > 0 ? remainingAmountBtc : 0).toFixed(8)),
        remaining_amount_xmr: Number((remainingAmountXmr > 0 ? remainingAmountXmr : 0).toFixed(12)),
        remaining_amount_ltc: Number((remainingAmountLtc > 0 ? remainingAmountLtc : 0).toFixed(8)),
        remaining_amount_usd: Number((remainingAmountUsd > 0 ? remainingAmountUsd : 0).toFixed(2)),
        address_btc: addresses.btc,
        address_xmr: addresses.xmr,
        address_ltc: addresses.ltc,
        raised_amount_percent: Math.floor((allDonationsSumUsd / project.goal) * 100),
        contributions,
      }
    })
  )

  if (query.asset) {
    responseBody = responseBody.map<ResponseBodySpecificAsset[0]>((project) => {
      const targetAmounts: Record<Asset, number> = {
        BTC: project.target_amount_btc,
        XMR: project.target_amount_xmr,
        LTC: project.target_amount_ltc,
        USD: project.target_amount_usd,
      }

      const remainingAmounts: Record<Asset, number> = {
        BTC: project.remaining_amount_btc,
        XMR: project.remaining_amount_xmr,
        LTC: project.remaining_amount_ltc,
        USD: project.remaining_amount_usd,
      }

      const addresses: Record<Asset, string | null> = {
        BTC: project.address_btc,
        XMR: project.address_xmr,
        LTC: project.address_ltc,
        USD: null,
      }

      return {
        title: project.title,
        fund: project.fund,
        date: project.date,
        author: project.author,
        url: project.url,
        is_funded: project.is_funded,
        target_amount: targetAmounts[query.asset!],
        remaining_amount: remainingAmounts[query.asset!],
        address: addresses[query.asset!],
        raised_amount_percent: project.raised_amount_percent,
        contributions: project.contributions,
        asset: query.asset!,
      }
    })
  }

  // Store response in cache
  cachedResponses[cacheKey] = {
    data: responseBody,
    expiresAt: dayjs().add(10, 'minutes').toDate(),
  }

  return res.send(responseBody)
}

export default handle
