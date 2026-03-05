import { DonationAccounting } from '@prisma/client'
import { prisma } from '../services'
import { BtcPayListInvoiceItem, DonationCryptoPayments } from '../types'
import { getDeposits, getClosedSellOrders, KrakenDeposit, KrakenSellOrder } from './kraken'
import { getNetworkFee } from './blockexplorers'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from './btcpayserver'

type PaymentItem = {
  paymentId: string
  invoiceId: string
  receivedAt: Date
  cryptoCode: string
  cryptoAmount: number
  cryptoAmountRaw: string
  rate: string
  fiatAmount: number
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
  invoiceId: string
  receivedAt: Date
  cryptoCode: string
  cryptoAmountRaw: string
  rate: string
  fiatAmount: number
  deposits: MatchedDeposit[]
  orders: MatchedOrder[]
  totalRealizedUsd: number
}

const EPSILON = 1e-8
const AMOUNT_TOLERANCE = 1e-6

const IGNORED_DEPOSIT_TXIDS: string[] = []
const IGNORED_ORDER_IDS: string[] = []
const IGNORED_PAYMENT_IDS: string[] = []

async function extractPaymentItems(invoices: BtcPayListInvoiceItem[]): Promise<PaymentItem[]> {
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
          // Look up rate from DB donation's cryptoPayments by matching amount
          rate =
            findFundingApiRate(
              fundingDonationsByInvoice.get(invoice.id) || [],
              cryptoCode,
              cryptoAmount
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
        })
      }
    }
  }

  items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  return items
}

function findFundingApiRate(
  donations: { cryptoPayments: any }[],
  cryptoCode: string,
  paymentAmount: number
): string | null {
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
        cache.set(dep.txid, dep.networkFee)
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
    let paymentRemaining = payment.cryptoAmount

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

      paymentRemaining -= matchCrypto
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
 * Phase B: Match deposit amounts to sell order volumes using a sequential
 * waterfall.
 */
type DepositOrderLink = {
  depositTxid: string
  orderId: string
  order: KrakenSellOrder
  matchedCrypto: number
  matchedUsd: number
}

function matchDepositsToOrders(
  deposits: KrakenDeposit[],
  orders: KrakenSellOrder[]
): DepositOrderLink[] {
  const links: DepositOrderLink[] = []

  let orderIdx = 0
  let orderRemaining = orders.length > 0 ? orders[0].volExec : 0

  for (const deposit of deposits) {
    let depositRemaining = deposit.amount

    while (depositRemaining > EPSILON && orderIdx < orders.length) {
      const order = orders[orderIdx]
      const matchCrypto = Math.min(depositRemaining, orderRemaining)
      const proportion = order.volExec > EPSILON ? matchCrypto / order.volExec : 0
      const matchedUsd = proportion * order.netProceeds

      links.push({
        depositTxid: deposit.txid,
        orderId: order.orderId,
        order,
        matchedCrypto: matchCrypto,
        matchedUsd,
      })

      depositRemaining -= matchCrypto
      orderRemaining -= matchCrypto

      if (orderRemaining <= EPSILON) {
        orderIdx++
        orderRemaining = orderIdx < orders.length ? orders[orderIdx].volExec : 0
      }
    }
  }

  return links
}

/**
 * Roll up: for each payment, trace matched deposits -> matched orders to
 * compute totalRealizedUsd and build the order list.
 */
function rollUpMatches(
  payments: PaymentItem[],
  paymentDeposits: Map<string, MatchedDeposit[]>,
  depositOrderLinks: DepositOrderLink[]
): PaymentMatch[] {
  const linkQueues = new Map<string, DepositOrderLink[]>()
  for (const link of depositOrderLinks) {
    const queue = linkQueues.get(link.depositTxid) || []
    queue.push({ ...link })
    linkQueues.set(link.depositTxid, queue)
  }

  const queuePositions = new Map<string, { idx: number; consumed: number }>()
  const results: PaymentMatch[] = []

  for (const payment of payments) {
    const deposits = paymentDeposits.get(payment.paymentId) || []
    const orders: MatchedOrder[] = []
    let totalRealizedUsd = 0

    for (const dep of deposits) {
      let cryptoToAllocate = dep.matchedCrypto
      const queue = linkQueues.get(dep.txid) || []
      let pos = queuePositions.get(dep.txid) || { idx: 0, consumed: 0 }

      while (cryptoToAllocate > EPSILON && pos.idx < queue.length) {
        const link = queue[pos.idx]
        const linkRemaining = link.matchedCrypto - pos.consumed
        const take = Math.min(cryptoToAllocate, linkRemaining)
        const proportion = link.matchedCrypto > EPSILON ? take / link.matchedCrypto : 0
        const usd = proportion * link.matchedUsd

        orders.push({
          orderId: link.orderId,
          closedAt: link.order.closedAt.toISOString(),
          pair: link.order.pair,
          volExec: link.order.volExec,
          cost: link.order.cost,
          fee: link.order.fee,
          netProceeds: link.order.netProceeds,
          matchedCrypto: take,
          matchedUsd: usd,
        })

        totalRealizedUsd += usd
        cryptoToAllocate -= take
        pos.consumed += take

        if (pos.consumed >= link.matchedCrypto - EPSILON) {
          pos.idx++
          pos.consumed = 0
        }
      }

      queuePositions.set(dep.txid, pos)
    }

    // Aggregate orders by orderId
    const aggregatedOrders: MatchedOrder[] = []
    const orderMap = new Map<string, MatchedOrder>()
    for (const o of orders) {
      const existing = orderMap.get(o.orderId)
      if (existing) {
        existing.matchedCrypto += o.matchedCrypto
        existing.matchedUsd += o.matchedUsd
      } else {
        const entry = { ...o }
        orderMap.set(o.orderId, entry)
        aggregatedOrders.push(entry)
      }
    }

    results.push({
      paymentId: payment.paymentId,
      invoiceId: payment.invoiceId,
      receivedAt: payment.receivedAt,
      cryptoCode: payment.cryptoCode,
      cryptoAmountRaw: payment.cryptoAmountRaw,
      rate: payment.rate,
      fiatAmount: payment.fiatAmount,
      deposits,
      orders: aggregatedOrders,
      totalRealizedUsd: Math.round(totalRealizedUsd * 100) / 100,
    })
  }

  return results
}

export async function generateAccountingRecords(): Promise<DonationAccounting[]> {
  console.log('[accounting] Starting accounting record generation...')

  const [invoices, existingRecords] = await Promise.all([
    getBtcPayInvoices(),
    prisma.donationAccounting.findMany({ orderBy: { paymentReceivedAt: 'asc' } }),
  ])

  console.log(`[accounting] Found ${invoices.length} BTCPay invoices with payments`)

  if (invoices.length === 0) {
    return existingRecords
  }

  const paymentItems = await extractPaymentItems(invoices)
  console.log(`[accounting] Extracted ${paymentItems.length} individual payments`)

  if (paymentItems.length === 0) {
    return existingRecords
  }

  const existingIds = new Set(existingRecords.map((r) => r.paymentId))
  const newPayments = paymentItems.filter((p) => !existingIds.has(p.paymentId))

  if (newPayments.length === 0) {
    console.log('[accounting] All payments already have accounting records')
    return existingRecords
  }

  console.log(`[accounting] ${newPayments.length} payments need accounting records`)

  const earliestDate = paymentItems[0].receivedAt

  const [allDeposits, allSellOrders] = await Promise.all([
    getDeposits(earliestDate),
    getClosedSellOrders(earliestDate),
  ])

  const deposits = allDeposits.filter((d) => !IGNORED_DEPOSIT_TXIDS.includes(d.txid))
  const sellOrders = allSellOrders.filter((o) => !IGNORED_ORDER_IDS.includes(o.orderId))

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
    const codePayments = paymentsByCode.get(code) || []
    const codeDeposits = depositsByCode.get(code) || []
    const codeOrders = ordersByCode.get(code) || []

    console.log(
      `[accounting] Matching ${code}: ${codePayments.length} payments, ${codeDeposits.length} deposits, ${codeOrders.length} sell orders`
    )

    const paymentDeposits = matchPaymentsToDeposits(codePayments, codeDeposits, networkFees)
    const depositOrderLinks = matchDepositsToOrders(codeDeposits, codeOrders)
    const matches = rollUpMatches(codePayments, paymentDeposits, depositOrderLinks)

    allMatches.push(...matches)
  }

  const matchesForNew = allMatches.filter((m) => !existingIds.has(m.paymentId))

  console.log(`[accounting] Upserting ${matchesForNew.length} accounting records...`)

  for (const match of matchesForNew) {
    await prisma.donationAccounting.upsert({
      where: { paymentId: match.paymentId },
      create: {
        invoiceId: match.invoiceId,
        paymentId: match.paymentId,
        paymentReceivedAt: match.receivedAt,
        cryptoCode: match.cryptoCode,
        cryptoAmount: match.cryptoAmountRaw,
        rate: match.rate,
        fiatAmount: match.fiatAmount,
        krakenDeposits: match.deposits,
        krakenOrders: match.orders,
        totalRealizedUsd: match.totalRealizedUsd,
      },
      update: {
        krakenDeposits: match.deposits,
        krakenOrders: match.orders,
        totalRealizedUsd: match.totalRealizedUsd,
      },
    })
  }

  console.log('[accounting] Done generating accounting records')

  return prisma.donationAccounting.findMany({ orderBy: { paymentReceivedAt: 'asc' } })
}
