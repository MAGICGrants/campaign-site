import { DonationAccounting, DonationSource, FundSlug } from '@prisma/client'
import { prisma } from '../services'
import { BtcPayListInvoiceItem, DonationCryptoPayments } from '../types'
import { getDeposits, getClosedSellOrders, KrakenDeposit, KrakenSellOrder } from './kraken'
import { getNetworkFee } from './blockexplorers'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from './btcpayserver'
import { CoinbaseCdpCheckout, getCoinbaseCdpCheckouts } from './coinbase-cdp'
import { syncStripeDonationAccounting } from './stripe-accounting'

/** When there are no Stripe rows in DonationAccounting yet, sync starts from this instant (inclusive). */
const STRIPE_SYNC_START_IF_NO_STRIPE_ROWS = new Date(Date.UTC(2024, 0, 1))

/** Re-list from this far before the newest Stripe row so borderline / delayed objects are not skipped. */
const STRIPE_SYNC_INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000

/** Stripe list filters use `created: { lt: endTs }`; add slack so same-second events are not dropped. */
const STRIPE_SYNC_END_SLACK_SEC = 120

type PaymentItem = {
  paymentId: string
  invoiceId: string | null
  receivedAt: Date
  cryptoCode: string
  cryptoAmount: number
  cryptoAmountRaw: string
  rate: string
  fiatAmount: number
  cryptoProcessorFee?: string | null
  fiatProcessorFee?: number | null
  projectSlug: string | null
  projectName: string | null
  fundSlug: FundSlug | null
  source: DonationSource
}

type MatchedDeposit = {
  txid: string
  time: string
  cryptoCode: string
  depositAmount: number
  krakenFee: number
  networkFee: number
  matchedCrypto: number
}

type MatchedOrder = {
  orderId: string
  closedAt: string
  pair: string
  volExec: number
  cost: number
  fee: number
  netProceeds: number
  matchedCrypto: number
  matchedUsd: number
}

type PaymentMatch = {
  paymentId: string
  invoiceId: string | null
  receivedAt: Date
  cryptoCode: string
  cryptoAmountRaw: string
  rate: string
  fiatAmount: number
  cryptoProcessorFee: string | null
  fiatProcessorFee: number | null
  deposits: MatchedDeposit[]
  orders: MatchedOrder[]
  totalRealizedUsd: number
  projectSlug: string | null
  projectName: string | null
  fundSlug: FundSlug | null
  source: DonationSource
}

const EPSILON = 1e-8
const AMOUNT_TOLERANCE = 1e-6

/**
 * Crypto subtotal minus Coinbase Commerce crypto processor fee (when present).
 * Kraken deposits reflect what landed after Coinbase’s cut; BTCPay has no such fee on this field.
 */
function netCryptoForMatching(payment: PaymentItem): number {
  const gross = payment.cryptoAmount
  const feeStr = payment.cryptoProcessorFee
  if (feeStr == null || feeStr.trim() === '') return gross
  const fee = Number(feeStr)
  if (Number.isNaN(fee) || fee < 0) return gross
  return Math.max(0, gross - fee)
}

const IGNORED_PAYMENT_IDS: string[] = []

async function loadAccountingIgnores(): Promise<{
  depositTxids: string[]
  orderIds: string[]
}> {
  const records = await prisma.accountingIgnore.findMany()
  return {
    depositTxids: records.filter((r) => r.type === 'deposit').map((r) => r.value),
    orderIds: records.filter((r) => r.type === 'order').map((r) => r.value),
  }
}

async function extractBtcPayPaymentItems(
  invoices: BtcPayListInvoiceItem[]
): Promise<PaymentItem[]> {
  const items: PaymentItem[] = []

  // Pre-fetch DB donations for funding API invoices (need rates from cryptoPayments)
  const fundingApiInvoiceIds = invoices
    .filter((inv) => inv.metadata?.staticGeneratedForApi === 'true')
    .map((inv) => inv.id)

  const fundingDonations =
    fundingApiInvoiceIds.length > 0
      ? await prisma.donation.findMany({
          where: { btcPayInvoiceId: { in: fundingApiInvoiceIds } },
          select: { btcPayInvoiceId: true, cryptoPayments: true },
        })
      : []

  // Index funding donations by invoiceId for quick lookup
  const fundingDonationsByInvoice = new Map<string, typeof fundingDonations>()
  for (const d of fundingDonations) {
    if (!d.btcPayInvoiceId) continue
    const group = fundingDonationsByInvoice.get(d.btcPayInvoiceId) || []
    group.push(d)
    fundingDonationsByInvoice.set(d.btcPayInvoiceId, group)
  }

  for (const invoice of invoices) {
    let paymentMethods
    try {
      paymentMethods = await getBtcPayInvoicePaymentMethods(invoice.id)
    } catch {
      console.warn(`[accounting] Skipping invoice ${invoice.id}: failed to fetch payment methods`)
      continue
    }

    const isFundingApi = invoice.metadata?.staticGeneratedForApi === 'true'

    for (const pm of paymentMethods) {
      const cryptoCode = pm.currency
      if (!['BTC', 'LTC', 'XMR'].includes(cryptoCode)) continue

      for (const payment of pm.payments) {
        if (payment.status !== 'Settled') continue
        if (IGNORED_PAYMENT_IDS.includes(payment.id)) continue
        const cryptoAmount = Number(payment.value)
        if (cryptoAmount <= 0) continue

        let rate: string

        if (isFundingApi) {
          // Look up rate from DB donation's cryptoPayments by payment id, or by amount
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

        items.push({
          paymentId: payment.id,
          invoiceId: invoice.id,
          receivedAt: new Date(payment.receivedDate * 1000),
          cryptoCode,
          cryptoAmount,
          cryptoAmountRaw: payment.value,
          rate,
          fiatAmount: Number((cryptoAmount * Number(rate)).toFixed(2)),
          projectSlug: invoice.metadata.projectSlug ?? null,
          projectName: invoice.metadata.projectName ?? null,
          fundSlug: invoice.metadata.fundSlug ?? null,
          source: DonationSource.btcpayserver,
        })
      }
    }
  }

  items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  return items
}

function parseMetadataFromCheckoutMetadata(
  meta: Record<string, string> | undefined
): { projectSlug: string; projectName: string; fundSlug: FundSlug } | null {
  if (!meta?.fundSlug) return null
  const fundSlug = meta.fundSlug as FundSlug
  if (!fundSlug || !Object.values(FundSlug).includes(fundSlug)) return null
  return {
    projectSlug: meta.projectSlug ?? 'general',
    projectName: meta.projectName ?? 'General',
    fundSlug,
  }
}

async function extractCoinbasePaymentItems(checkouts: CoinbaseCdpCheckout[]): Promise<PaymentItem[]> {
  const items: PaymentItem[] = []

  for (const co of checkouts) {
    if (co.status !== 'COMPLETED') continue
    if (co.currency !== 'USDC') continue

    const cryptoAmount = Number(co.amount)
    if (cryptoAmount <= 0) continue

    if (IGNORED_PAYMENT_IDS.includes(co.id)) continue

    const paymentId = co.transactionHash?.trim() || co.id
    if (!paymentId) continue

    const metadata = parseMetadataFromCheckoutMetadata(co.metadata)

    const receivedAt = new Date(co.updatedAt)
    const rate = '1'
    const fiatAmount = cryptoAmount

    const feeStr = co.settlement?.feeAmount?.trim()
    const feeNum = feeStr ? Number(feeStr) : NaN
    const cryptoProcessorFee =
      feeStr && !Number.isNaN(feeNum) && feeNum > 0 ? feeStr : undefined
    const fiatProcessorFee =
      !Number.isNaN(feeNum) && feeNum > 0 ? feeNum : undefined

    items.push({
      paymentId,
      invoiceId: co.id,
      receivedAt,
      cryptoCode: 'USDC',
      cryptoAmount,
      cryptoAmountRaw: co.amount,
      rate,
      fiatAmount,
      cryptoProcessorFee,
      fiatProcessorFee,
      projectSlug: metadata?.projectSlug ?? null,
      projectName: metadata?.projectName ?? null,
      fundSlug: metadata?.fundSlug ?? null,
      source: DonationSource.coinbase,
    })
  }

  items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  return items
}

function findFundingApiRate(
  donations: { cryptoPayments: any }[],
  cryptoCode: string,
  paymentAmount: number,
  paymentId: string
): string | null {
  // First pass: match by payment id (txId)
  for (const donation of donations) {
    const payments = donation.cryptoPayments as DonationCryptoPayments | null
    if (!payments) continue
    for (const cp of payments) {
      if (cp.cryptoCode !== cryptoCode) continue
      if (cp.txId && cp.txId === paymentId) return cp.rate
    }
  }
  // Fall back: match by amount
  for (const donation of donations) {
    const payments = donation.cryptoPayments as DonationCryptoPayments | null
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

function buildNetworkFeeCache(existingRecords: DonationAccounting[]): Map<string, number> {
  const cache = new Map<string, number>()

  for (const record of existingRecords) {
    const deposits = record.krakenDeposits as MatchedDeposit[] | null
    if (!deposits) continue
    for (const dep of deposits) {
      if (dep.txid && dep.networkFee != null) {
        const current = cache.get(dep.txid) ?? 0
        cache.set(dep.txid, current + dep.networkFee)
      }
    }
  }

  return cache
}

async function fetchNetworkFees(
  deposits: KrakenDeposit[],
  cache: Map<string, number>
): Promise<Map<string, number>> {
  const feeMap = new Map<string, number>(cache)

  for (const deposit of deposits) {
    if (feeMap.has(deposit.txid)) continue

    try {
      const fee = await getNetworkFee(deposit.txid, deposit.cryptoCode)
      feeMap.set(deposit.txid, fee)
      console.log(
        `[accounting] Network fee for ${deposit.cryptoCode} tx ${deposit.txid.slice(0, 8)}...: ${fee}`
      )
    } catch (err) {
      console.warn(
        `[accounting] Failed to fetch network fee for ${deposit.cryptoCode} tx ${deposit.txid.slice(0, 8)}...: ${err instanceof Error ? err.message : err}`
      )
      feeMap.set(deposit.txid, 0)
    }
  }

  return feeMap
}

/**
 * Ensures each payment has a non-empty paymentId for map keys and upsert.
 * Generates a stable id for payments that lack one.
 */
function normalizePaymentItems(
  items: (Omit<PaymentItem, 'paymentId'> & { paymentId?: string | null })[]
): PaymentItem[] {
  return items.map((item, idx) => ({
    ...item,
    paymentId:
      item.paymentId && item.paymentId.trim()
        ? item.paymentId
        : `_manual_${item.source}_${item.receivedAt.getTime()}_${item.cryptoAmount}_${item.cryptoCode}_${idx}`,
    invoiceId: item.invoiceId ?? null,
    projectSlug: item.projectSlug ?? null,
    projectName: item.projectName ?? null,
    fundSlug: item.fundSlug ?? null,
  }))
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = map.get(key) || []
    group.push(item)
    map.set(key, group)
  }
  return map
}

/**
 * Phase A: Match payment crypto amounts to deposit amounts using a sequential
 * waterfall. Returns a map of paymentId -> list of matched deposit portions.
 */
function matchPaymentsToDeposits(
  payments: PaymentItem[],
  deposits: KrakenDeposit[],
  networkFees: Map<string, number>
): Map<string, MatchedDeposit[]> {
  const result = new Map<string, MatchedDeposit[]>()
  for (const p of payments) result.set(p.paymentId, [])

  let depIdx = 0
  let depositRemaining = deposits.length > 0 ? deposits[0].amount : 0

  for (const payment of payments) {
    let paymentRemaining = netCryptoForMatching(payment)

    while (paymentRemaining > EPSILON && depIdx < deposits.length) {
      const deposit = deposits[depIdx]
      const matchCrypto = Math.min(paymentRemaining, depositRemaining)

      const networkFee = networkFees.get(deposit.txid) ?? 0
      const proportionalNetworkFee =
        deposit.amount > EPSILON ? (matchCrypto / deposit.amount) * networkFee : 0

      result.get(payment.paymentId)!.push({
        txid: deposit.txid,
        time: deposit.time.toISOString(),
        cryptoCode: deposit.cryptoCode,
        depositAmount: deposit.amount,
        krakenFee: deposit.fee,
        networkFee: proportionalNetworkFee,
        matchedCrypto: matchCrypto,
      })

      paymentRemaining -= matchCrypto + proportionalNetworkFee
      depositRemaining -= matchCrypto

      if (depositRemaining <= EPSILON) {
        depIdx++
        depositRemaining = depIdx < deposits.length ? deposits[depIdx].amount : 0
      }
    }
  }

  return result
}

/**
 * Phase B: Match payment crypto amounts to sell order volumes using a sequential
 * waterfall. Independent of deposits - uses the same crypto amount each payment
 * matched to deposits, but consumes from the order queue in order sequence.
 */
function matchPaymentsToOrders(
  payments: PaymentItem[],
  paymentDeposits: Map<string, MatchedDeposit[]>,
  orders: KrakenSellOrder[]
): Map<string, MatchedOrder[]> {
  const result = new Map<string, MatchedOrder[]>()
  for (const p of payments) result.set(p.paymentId, [])

  let orderIdx = 0
  let orderRemaining = orders.length > 0 ? orders[0].volExec : 0

  for (const payment of payments) {
    const deposits = paymentDeposits.get(payment.paymentId) || []
    let cryptoToAllocate = deposits.reduce((sum, d) => sum + d.matchedCrypto, 0)
    const paymentOrders: MatchedOrder[] = []

    while (cryptoToAllocate > EPSILON && orderIdx < orders.length) {
      const order = orders[orderIdx]
      const matchCrypto = Math.min(cryptoToAllocate, orderRemaining)
      const proportion = order.volExec > EPSILON ? matchCrypto / order.volExec : 0
      const matchedUsd = proportion * order.netProceeds

      const existingOrder = paymentOrders.find((o) => o.orderId === order.orderId)
      if (existingOrder) {
        existingOrder.matchedCrypto += matchCrypto
        existingOrder.matchedUsd += matchedUsd
      } else {
        paymentOrders.push({
          orderId: order.orderId,
          closedAt: order.closedAt.toISOString(),
          pair: order.pair,
          volExec: order.volExec,
          cost: order.cost,
          fee: order.fee,
          netProceeds: order.netProceeds,
          matchedCrypto: matchCrypto,
          matchedUsd: matchedUsd,
        })
      }

      cryptoToAllocate -= matchCrypto
      orderRemaining -= matchCrypto

      if (orderRemaining <= EPSILON) {
        orderIdx++
        orderRemaining = orderIdx < orders.length ? orders[orderIdx].volExec : 0
      }
    }

    result.set(payment.paymentId, paymentOrders)
  }

  return result
}

/**
 * Roll up: for each payment, combine deposits and orders (both from independent
 * waterfalls) and compute totalRealizedUsd from the orders.
 */
function rollUpMatches(
  payments: PaymentItem[],
  paymentDeposits: Map<string, MatchedDeposit[]>,
  paymentOrders: Map<string, MatchedOrder[]>
): PaymentMatch[] {
  const results: PaymentMatch[] = []

  for (const payment of payments) {
    const deposits = paymentDeposits.get(payment.paymentId) || []
    const orders = paymentOrders.get(payment.paymentId) || []
    const totalRealizedUsd = orders.reduce((sum, o) => sum + o.matchedUsd, 0)

    deposits.sort((a, b) => a.time.localeCompare(b.time))
    orders.sort((a, b) => a.closedAt.localeCompare(b.closedAt))

    results.push({
      paymentId: payment.paymentId,
      invoiceId: payment.invoiceId,
      receivedAt: payment.receivedAt,
      cryptoCode: payment.cryptoCode,
      cryptoAmountRaw: payment.cryptoAmountRaw,
      rate: payment.rate,
      fiatAmount: payment.fiatAmount,
      cryptoProcessorFee: payment.cryptoProcessorFee ?? null,
      fiatProcessorFee: payment.fiatProcessorFee ?? null,
      deposits,
      orders,
      totalRealizedUsd: Math.round(totalRealizedUsd * 100) / 100,
      projectSlug: payment.projectSlug,
      projectName: payment.projectName,
      fundSlug: payment.fundSlug,
      source: payment.source,
    })
  }

  return results
}

export async function generateAccountingRecords(): Promise<DonationAccounting[]> {
  console.log('[accounting] Starting accounting record generation...')

  const [btcPayInvoices, existingRecords, coinbaseCheckouts] = await Promise.all([
    getBtcPayInvoices(),
    prisma.donationAccounting.findMany({ orderBy: { paymentReceivedAt: 'asc' } }),
    getCoinbaseCdpCheckouts(),
  ])

  console.log(
    `[accounting] Found ${btcPayInvoices.length} BTCPay invoices, ${coinbaseCheckouts.length} Coinbase CDP checkouts`
  )

  const [btcPayItems, coinbaseCdpItems] = await Promise.all([
    extractBtcPayPaymentItems(btcPayInvoices),
    extractCoinbasePaymentItems(coinbaseCheckouts),
  ])

  const rawPaymentItems = [...btcPayItems, ...coinbaseCdpItems]
  const paymentItems = normalizePaymentItems(rawPaymentItems).sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  )
  console.log(
    `[accounting] Extracted ${paymentItems.length} individual payments (${btcPayItems.length} BTCPay, ${coinbaseCdpItems.length} Coinbase CDP)`
  )

  const existingIds = new Set(existingRecords.map((r) => r.paymentId).filter(Boolean))

  if (paymentItems.length > 0) {
    const newPayments = paymentItems.filter((p) => !existingIds.has(p.paymentId))

    if (newPayments.length > 0) {
      console.log(`[accounting] ${newPayments.length} payments need accounting records`)

      const earliestDate = paymentItems[0].receivedAt

      const [allDeposits, allSellOrders, ignores] = await Promise.all([
        getDeposits(earliestDate),
        getClosedSellOrders(earliestDate),
        loadAccountingIgnores(),
      ])

      const deposits = allDeposits.filter((d) => !ignores.depositTxids.includes(d.txid))
      const sellOrders = allSellOrders.filter((o) => !ignores.orderIds.includes(o.orderId))

      console.log(
        `[accounting] Fetched ${allDeposits.length} deposits (${allDeposits.length - deposits.length} ignored) and ${allSellOrders.length} sell orders (${allSellOrders.length - sellOrders.length} ignored)`
      )

      const networkFeeCache = buildNetworkFeeCache(existingRecords)
      const networkFees = await fetchNetworkFees(deposits, networkFeeCache)

      const cryptoCodes = [...new Set(paymentItems.map((p) => p.cryptoCode))]
      const paymentsByCode = groupBy(paymentItems, (p) => p.cryptoCode)
      const depositsByCode = groupBy(deposits, (d) => d.cryptoCode)
      const ordersByCode = groupBy(sellOrders, (o) => o.cryptoCode)

      const allMatches: PaymentMatch[] = []

      for (const code of cryptoCodes) {
        const codePayments = (paymentsByCode.get(code) || []).sort(
          (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
        )
        const codeDeposits = (depositsByCode.get(code) || []).sort(
          (a, b) => a.time.getTime() - b.time.getTime()
        )
        const codeOrders = (ordersByCode.get(code) || []).sort(
          (a, b) => a.closedAt.getTime() - b.closedAt.getTime()
        )

        console.log(
          `[accounting] Matching ${code}: ${codePayments.length} payments, ${codeDeposits.length} deposits, ${codeOrders.length} sell orders`
        )

        const paymentDeposits = matchPaymentsToDeposits(codePayments, codeDeposits, networkFees)
        const paymentOrders = matchPaymentsToOrders(codePayments, paymentDeposits, codeOrders)
        const matches = rollUpMatches(codePayments, paymentDeposits, paymentOrders)

        allMatches.push(...matches)
      }

      const matchesForNew = allMatches.filter((m) => !existingIds.has(m.paymentId))

      console.log(`[accounting] Upserting ${matchesForNew.length} accounting records...`)

      for (const match of matchesForNew) {
        await prisma.donationAccounting.upsert({
          where: { paymentId: match.paymentId },
          create: {
            source: match.source,
            invoiceId: match.invoiceId,
            paymentId: match.paymentId,
            paymentReceivedAt: match.receivedAt,
            cryptoCode: match.cryptoCode,
            cryptoAmount: match.cryptoAmountRaw,
            rate: match.rate,
            fiatAmount: match.fiatAmount,
            cryptoProcessorFee: match.cryptoProcessorFee,
            fiatProcessorFee: match.fiatProcessorFee,
            krakenDeposits: match.deposits,
            krakenOrders: match.orders,
            totalRealizedUsd: match.totalRealizedUsd,
            projectSlug: match.projectSlug,
            projectName: match.projectName,
            fundSlug: match.fundSlug,
          },
          update: {
            krakenDeposits: match.deposits,
            krakenOrders: match.orders,
            totalRealizedUsd: match.totalRealizedUsd,
            cryptoProcessorFee: match.cryptoProcessorFee,
            fiatProcessorFee: match.fiatProcessorFee,
          },
        })
      }
    } else {
      console.log('[accounting] All BTCPay/Coinbase payments already have accounting records')
    }
  } else {
    console.log('[accounting] No BTCPay/Coinbase payment items to process')
  }

  const latestStripe = await prisma.donationAccounting.findFirst({
    where: { source: 'stripe' },
    orderBy: { paymentReceivedAt: 'desc' },
    select: { paymentReceivedAt: true },
  })
  const stripeSyncStart =
    latestStripe == null
      ? STRIPE_SYNC_START_IF_NO_STRIPE_ROWS
      : new Date(latestStripe.paymentReceivedAt.getTime() - STRIPE_SYNC_INCREMENTAL_OVERLAP_MS)
  const startTs = Math.floor(stripeSyncStart.getTime() / 1000)
  const endTs = Math.floor(Date.now() / 1000) + STRIPE_SYNC_END_SLACK_SEC

  console.log(`[accounting] Syncing Stripe into DonationAccounting from ${stripeSyncStart.toISOString()}…`)
  const { upserted } = await syncStripeDonationAccounting({ startTs, endTs })
  console.log(`[accounting] Stripe sync completed (${upserted} upserts)`)

  console.log('[accounting] Done generating accounting records')

  return prisma.donationAccounting.findMany({ orderBy: { paymentReceivedAt: 'asc' } })
}
