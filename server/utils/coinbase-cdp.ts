import crypto from 'crypto'
import jwt from 'jsonwebtoken'

import { env } from '../../env.mjs'
import { log } from '../../utils/logging'
import { coinbaseCdpApi } from '../services'
import { DonationMetadata } from '../types'

/** Checkout row from `GET /checkouts` (list / detail). */
export type CoinbaseCdpCheckout = {
  id: string
  status: string
  amount: string
  currency: string
  network?: string
  transactionHash?: string
  metadata?: Record<string, string>
  settlement?: {
    totalAmount: string
    feeAmount: string
    netAmount: string
    currency?: string
  }
  createdAt: string
  updatedAt: string
}

type ListCheckoutsResponse = {
  checkouts: CoinbaseCdpCheckout[]
  nextPageToken?: string
}

function generateCdpJwt(requestMethod: string, requestHost: string, requestPath: string): string {
  const algorithm = 'ES256'
  const uri = `${requestMethod} ${requestHost}${requestPath}`

  const payload = {
    iss: 'cdp',
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
    sub: env.COINBASE_CDP_API_KEY_ID,
    uri,
  }

  const header = {
    alg: algorithm,
    kid: env.COINBASE_CDP_API_KEY_ID,
    nonce: crypto.randomBytes(16).toString('hex'),
  }

  return jwt.sign(payload, env.COINBASE_CDP_API_KEY_PRIVATE_KEY, { algorithm, header })
}

export async function getCoinbaseCdpCheckouts(): Promise<CoinbaseCdpCheckout[]> {
  if (!env.COINBASE_CDP_API_KEY_ID || !env.COINBASE_CDP_API_KEY_PRIVATE_KEY) {
    console.warn('Coinbase CDP API key ID or private key not configured, skipping checkout fetch')
    return []
  }

  const all: CoinbaseCdpCheckout[] = []
  let pageToken: string | undefined

  log('info', '[accounting] Fetching Coinbase CDP checkouts...')

  do {
    const uri =
      env.NODE_ENV === 'development' || env.STAGING_MODE_ENABLED === 'true'
        ? '/sandbox/api/v1/checkouts'
        : '/api/v1/checkouts'
    const token = generateCdpJwt('GET', 'business.coinbase.com', uri)
    const params = new URLSearchParams({ pageSize: '100', status: 'COMPLETED' })
    if (pageToken) params.set('pageToken', pageToken)

    const { data } = await coinbaseCdpApi.get<ListCheckoutsResponse>(
      `${uri}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    all.push(...data.checkouts)
    pageToken = data.nextPageToken

    log('info', `[accounting] Fetched ${all.length} Coinbase checkouts so far`)
  } while (pageToken)

  log('info', `[accounting] Total Coinbase CDP checkouts: ${all.length}`)
  return all
}

/** Checkouts API metadata: string values only, max 20 keys / 100 chars per value. */
export function donationMetadataToCheckoutMetadata(m: DonationMetadata): Record<string, string> {
  const entries: [string, string | null][] = [
    ['userId', m.userId],
    ['donorEmail', m.donorEmail],
    ['donorName', m.donorName],
    ['donorNameIsProfane', m.donorNameIsProfane],
    ['projectSlug', m.projectSlug],
    ['projectName', m.projectName],
    ['fundSlug', m.fundSlug],
    ['isMembership', m.isMembership],
    ['membershipTerm', m.membershipTerm],
    ['isSubscription', m.isSubscription],
    ['isTaxDeductible', m.isTaxDeductible],
    ['staticGeneratedForApi', m.staticGeneratedForApi],
    ['givePointsBack', m.givePointsBack],
    ['showDonorNameOnLeaderboard', m.showDonorNameOnLeaderboard],
    ['itemDesc', m.itemDesc ?? null],
  ]
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    const s = v === null || v === undefined ? '' : String(v)
    out[k] = s.slice(0, 100)
  }
  return out
}

type CreateCheckoutResponse = {
  id: string
  url: string
  status: string
  amount: string
  currency: string
}

/**
 * Creates a Checkout on Coinbase Business (`POST /checkouts`).
 * @see https://docs.cdp.coinbase.com/api-reference/business-api/rest-api/checkouts/create-checkout
 */
export async function createCoinbaseCheckout({
  amountUsd,
  metadata,
}: {
  amountUsd: number
  metadata: DonationMetadata
}): Promise<{
  url: string
  id: string
}> {
  const uri =
    env.NODE_ENV === 'development' || env.STAGING_MODE_ENABLED === 'true'
      ? '/sandbox/api/v1/checkouts'
      : '/api/v1/checkouts'
  const token = generateCdpJwt('POST', 'business.coinbase.com', uri)

  const amountStr = amountUsd.toFixed(2)
  const description = `MAGIC Grants donation: ${metadata.projectName}`.slice(0, 500)

  const { data } = await coinbaseCdpApi.post<CreateCheckoutResponse>(
    uri,
    {
      amount: amountStr,
      currency: 'USDC',
      network: 'base',
      description,
      metadata: donationMetadataToCheckoutMetadata(metadata),
      // Coinbase won't let you use localhost URLs here
      successRedirectUrl:
        env.NODE_ENV === 'production'
          ? `${env.APP_URL}/${metadata.fundSlug}/thankyou`
          : 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExMDBrcjJhcm0xZnBhbjlqY2o4NW9ydnV2eWRwZWJpODJpaDhmM2U3MyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/5xtDarmwsuR9sDRObyU/giphy.gif',
      failRedirectUrl:
        env.NODE_ENV === 'production'
          ? `${env.APP_URL}/${metadata.fundSlug}`
          : 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExMDBrcjJhcm0xZnBhbjlqY2o4NW9ydnV2eWRwZWJpODJpaDhmM2U3MyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/5xtDarmwsuR9sDRObyU/giphy.gif',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Idempotency-Key': crypto.randomUUID(),
      },
    }
  )

  return { url: data.url, id: data.id }
}
