import crypto from 'crypto'
import { env } from '../../env.mjs'
import axios from 'axios'

export type KrakenSellOrder = {
  orderId: string
  pair: string
  cryptoCode: string
  volExec: number
  cost: number
  fee: number
  netProceeds: number
  closedAt: Date
}

type KrakenOrderDescr = {
  pair: string
  type: 'buy' | 'sell'
  ordertype: string
  price: string
  price2: string
  leverage: string
  order: string
  close: string
}

export type KrakenOrder = {
  refid: string | null
  userref: number
  status: 'pending' | 'open' | 'closed' | 'canceled' | 'expired'
  opentm: number
  closetm: number
  starttm: number
  expiretm: number
  descr: KrakenOrderDescr
  vol: string
  vol_exec: string
  cost: string
  fee: string
  price: string
  stopprice: string
  limitprice: string
  misc: string
  oflags: string
  reason: string | null
  trades?: string[]
}

type KrakenClosedOrdersResponse = {
  error: string[]
  result: {
    closed: Record<string, KrakenOrder>
    count: number
  }
}

export type KrakenDeposit = {
  asset: string
  cryptoCode: string
  txid: string
  amount: number
  fee: number
  time: Date
  status: string
}

type KrakenDepositEntry = {
  method: string
  aclass: string
  asset: string
  refid: string
  txid: string
  info: string
  amount: string
  fee: string
  time: number
  status: string
  'status-prop'?: string
  originators?: string | null
}

type KrakenDepositStatusResponse = {
  error: string[]
  result: { deposits: KrakenDepositEntry[]; next_cursor?: string }
}

const KRAKEN_API_URL = 'https://api.kraken.com'

// Starter tier: max counter 15, decay -1 every 3 seconds
const RATE_LIMIT_MAX = 15
const RATE_LIMIT_DECAY_INTERVAL_MS = 3000
const RATE_LIMIT_COST_PER_CALL = 1
const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_RETRY_BASE_MS = 5000

let rateLimitCounter = 0
let rateLimitLastUpdate = Date.now()
let lastNonce = 0

function applyRateLimitDecay() {
  const now = Date.now()
  const elapsed = now - rateLimitLastUpdate
  const decay = Math.floor(elapsed / RATE_LIMIT_DECAY_INTERVAL_MS)
  if (decay > 0) {
    rateLimitCounter = Math.max(0, rateLimitCounter - decay)
    rateLimitLastUpdate += decay * RATE_LIMIT_DECAY_INTERVAL_MS
  }
}

async function waitForRateLimit() {
  applyRateLimitDecay()

  if (rateLimitCounter + RATE_LIMIT_COST_PER_CALL > RATE_LIMIT_MAX) {
    const unitsNeeded = rateLimitCounter + RATE_LIMIT_COST_PER_CALL - RATE_LIMIT_MAX
    const waitMs = unitsNeeded * RATE_LIMIT_DECAY_INTERVAL_MS
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    applyRateLimitDecay()
  }

  rateLimitCounter += RATE_LIMIT_COST_PER_CALL
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const KRAKEN_ASSET_TO_CRYPTO: Record<string, string> = {
  XBT: 'BTC',
  XXBT: 'BTC',
  XMR: 'XMR',
  XXMR: 'XMR',
  LTC: 'LTC',
  XLTC: 'LTC',
}

const KRAKEN_PAIR_TO_CRYPTO: Record<string, string> = {
  XXBTZUSD: 'BTC',
  XBTUSD: 'BTC',
  XXMRZUSD: 'XMR',
  XMRUSD: 'XMR',
  XLTCZUSD: 'LTC',
  LTCUSD: 'LTC',
}

function generateNonce(): string {
  const nonce = Math.max(Date.now() * 1000, lastNonce + 1)
  lastNonce = nonce
  return String(nonce)
}

function getKrakenSignature(path: string, postData: string, nonce: string): string {
  const secret = env.KRAKEN_API_SECRET!
  const sha256Hash = crypto
    .createHash('sha256')
    .update(nonce + postData)
    .digest()

  const hmac = crypto
    .createHmac('sha512', Buffer.from(secret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), sha256Hash]))
    .digest('base64')

  return hmac
}

async function krakenRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    await waitForRateLimit()

    try {
      const path = `/0/private/${endpoint}`
      const nonce = generateNonce()

      const body = new URLSearchParams({ nonce, ...params })
      const signature = getKrakenSignature(path, body.toString(), nonce)
      const headers = {
        'API-Key': env.KRAKEN_API_KEY!,
        'API-Sign': signature,
      }

      const response = await axios.post(`${KRAKEN_API_URL}${path}`, body, { headers })
      const data = response.data as T & { error?: string[] }

      if (data.error && data.error.length > 0) {
        const isRateLimited = data.error.some((e: string) => e.includes('EAPI:Rate limit'))

        if (isRateLimited && attempt < RATE_LIMIT_MAX_RETRIES) {
          const backoff = RATE_LIMIT_RETRY_BASE_MS * Math.pow(2, attempt)
          console.log(
            `[accounting] Kraken ${endpoint}: rate limited, retrying in ${backoff}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
          )
          rateLimitCounter = RATE_LIMIT_MAX
          await sleep(backoff)
          continue
        }

        throw new Error(`Kraken API error: ${data.error.join(', ')}`)
      }

      return data
    } catch (err) {
      lastError = err

      if (attempt < RATE_LIMIT_MAX_RETRIES) {
        const backoff = RATE_LIMIT_RETRY_BASE_MS * Math.pow(2, attempt)
        console.log(
          `[accounting] Kraken ${endpoint}: ${err instanceof Error ? err.message : 'request failed'}, retrying in ${backoff}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
        )
        await sleep(backoff)
        continue
      }
    }
  }

  throw lastError ?? new Error('Kraken API: max retries exceeded')
}

function normalizeCryptoCode(pair: string): string | null {
  if (KRAKEN_PAIR_TO_CRYPTO[pair]) return KRAKEN_PAIR_TO_CRYPTO[pair]

  for (const [pattern, code] of Object.entries(KRAKEN_PAIR_TO_CRYPTO)) {
    if (pair.includes(pattern.replace('USD', '').replace('Z', '').replace('X', ''))) {
      return code
    }
  }

  return null
}

function isUsdPair(pair: string): boolean {
  return pair.endsWith('USD') || pair.endsWith('ZUSD')
}

export async function getClosedSellOrders(start: Date): Promise<KrakenSellOrder[]> {
  if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const allOrders: KrakenSellOrder[] = []
  let offset = 0
  let totalCount: number | null = null

  console.log(`[accounting] Fetching Kraken sell orders from ${start.toISOString()}...`)

  while (true) {
    const data = await krakenRequest<KrakenClosedOrdersResponse>('ClosedOrders', {
      start: String(Math.floor(start.getTime() / 1000)),
      ofs: String(offset),
    })

    console.log('Kraken closed orders count:', data.result.count)

    if (totalCount === null) totalCount = data.result.count

    const closed = data.result.closed
    const orderIds = Object.keys(closed)

    if (orderIds.length === 0) break

    for (const orderId of orderIds) {
      const order = closed[orderId]

      if (order.status !== 'closed' && order.vol_exec === '0') continue
      if (order.descr.type !== 'sell') continue
      if (!isUsdPair(order.descr.pair)) continue

      const cryptoCode = normalizeCryptoCode(order.descr.pair)
      if (!cryptoCode) continue

      const cost = Number(order.cost)
      const fee = Number(order.fee)

      allOrders.push({
        orderId,
        pair: order.descr.pair,
        cryptoCode,
        volExec: Number(order.vol_exec),
        cost,
        fee,
        netProceeds: cost - fee,
        closedAt: new Date(order.closetm * 1000),
      })
    }

    offset += orderIds.length
    const remaining = totalCount ? totalCount - offset : '?'
    console.log(
      `[accounting] Sell orders: ${offset}/${totalCount ?? '?'} scanned, ${remaining} remaining, ${allOrders.length} sell orders found`
    )

    if (orderIds.length < 50) break
  }

  console.log(`[accounting] Finished fetching sell orders: ${allOrders.length} sell orders total`)
  allOrders.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime())

  return allOrders
}

function normalizeAssetCode(asset: string): string | null {
  if (KRAKEN_ASSET_TO_CRYPTO[asset]) return KRAKEN_ASSET_TO_CRYPTO[asset]

  for (const [pattern, code] of Object.entries(KRAKEN_ASSET_TO_CRYPTO)) {
    if (asset.toUpperCase() === pattern.toUpperCase()) return code
  }

  return null
}

export async function getDeposits(start: Date): Promise<KrakenDeposit[]> {
  if (!env.KRAKEN_API_KEY || !env.KRAKEN_API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const allDeposits: KrakenDeposit[] = []

  console.log(`[accounting] Fetching Kraken deposits from ${start.toISOString()}...`)

  let cursor: string | undefined

  const initialParams = { start: Math.floor(start.getTime() / 1000), cursor: true }

  while (true) {
    const params = cursor ? { cursor: cursor } : initialParams

    const data = await krakenRequest<KrakenDepositStatusResponse>('DepositStatus', params)

    const deposits = data.result.deposits

    for (const deposit of deposits) {
      const cryptoCode = normalizeAssetCode(deposit.asset)
      if (!cryptoCode) continue

      allDeposits.push({
        asset: deposit.asset,
        cryptoCode,
        txid: deposit.txid,
        amount: Number(deposit.amount),
        fee: Number(deposit.fee),
        time: new Date(deposit.time * 1000),
        status: deposit.status,
      })
    }

    console.log(`[accounting] Deposits: ${allDeposits.length} fetched so far`)

    if (data.result.next_cursor) {
      cursor = data.result.next_cursor
    } else {
      break
    }
  }

  console.log(`[accounting] Finished fetching deposits: ${allDeposits.length} deposits total`)
  allDeposits.sort((a, b) => a.time.getTime() - b.time.getTime())

  return allDeposits
}
