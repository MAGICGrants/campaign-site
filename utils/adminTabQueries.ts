import type { ParsedUrlQuery } from 'querystring'

import type { SortDirection } from '../components/admin/sortable-table'

import {
  parseAdminDateRangeFromQuery,
  pickQueryStr,
} from './adminDateRange'

function parseDir(s: string | undefined, fallback: SortDirection): SortDirection {
  return s === 'desc' ? 'desc' : s === 'asc' ? 'asc' : fallback
}

// --- BTCPay ---

export type BtcpayAdminUrlState = {
  dateFrom: string
  dateTo: string
  fund: string
  project: string
  summaryColumnKey: 'fund' | 'total'
  summaryDirection: SortDirection
  paymentsColumnKey: string
  paymentsDirection: SortDirection
}

export function parseBtcpayAdminUrl(q: ParsedUrlQuery): BtcpayAdminUrlState {
  const { dateFrom, dateTo } = parseAdminDateRangeFromQuery(q)
  return {
    dateFrom,
    dateTo,
    fund: pickQueryStr(q, 'fund') ?? '__all__',
    project: pickQueryStr(q, 'project') ?? '__all__',
    summaryColumnKey:
      pickQueryStr(q, 'bSumCol') === 'total' ? 'total' : 'fund',
    summaryDirection: parseDir(pickQueryStr(q, 'bSumDir'), 'asc'),
    paymentsColumnKey: pickQueryStr(q, 'bPayCol') ?? 'time',
    paymentsDirection: parseDir(pickQueryStr(q, 'bPayDir'), 'asc'),
  }
}

export function serializeBtcpayAdminUrl(s: BtcpayAdminUrlState): Record<string, string> {
  return {
    from: s.dateFrom,
    to: s.dateTo,
    fund: s.fund,
    project: s.project,
    bSumCol: s.summaryColumnKey,
    bSumDir: s.summaryDirection,
    bPayCol: s.paymentsColumnKey,
    bPayDir: s.paymentsDirection,
  }
}

// --- Stripe invoices ---

export type StripeInvoicesAdminUrlState = {
  dateFrom: string
  dateTo: string
  fund: string
  project: string
  summaryColumnKey: 'fund' | 'amount' | 'fee' | 'net'
  summaryDirection: SortDirection
  invoicesColumnKey: string
  invoicesDirection: SortDirection
}

export function parseStripeInvoicesAdminUrl(q: ParsedUrlQuery): StripeInvoicesAdminUrlState {
  const { dateFrom, dateTo } = parseAdminDateRangeFromQuery(q)
  const sumCol = pickQueryStr(q, 'sSumCol')
  const summaryColumnKey: StripeInvoicesAdminUrlState['summaryColumnKey'] =
    sumCol === 'amount' || sumCol === 'fee' || sumCol === 'net' ? sumCol : 'fund'
  return {
    dateFrom,
    dateTo,
    fund: pickQueryStr(q, 'fund') ?? '__all__',
    project: pickQueryStr(q, 'project') ?? '__all__',
    summaryColumnKey,
    summaryDirection: parseDir(pickQueryStr(q, 'sSumDir'), 'asc'),
    invoicesColumnKey: pickQueryStr(q, 'sInvCol') ?? 'time',
    invoicesDirection: parseDir(pickQueryStr(q, 'sInvDir'), 'asc'),
  }
}

export function serializeStripeInvoicesAdminUrl(s: StripeInvoicesAdminUrlState): Record<string, string> {
  return {
    from: s.dateFrom,
    to: s.dateTo,
    fund: s.fund,
    project: s.project,
    sSumCol: s.summaryColumnKey,
    sSumDir: s.summaryDirection,
    sInvCol: s.invoicesColumnKey,
    sInvDir: s.invoicesDirection,
  }
}

// --- Kraken deposits ---

export type KrakenDepositsAdminUrlState = {
  dateFrom: string
  dateTo: string
  currency: string
  summaryColumnKey: 'currency' | 'total'
  summaryDirection: SortDirection
  depositsColumnKey: string
  depositsDirection: SortDirection
}

export function parseKrakenDepositsAdminUrl(q: ParsedUrlQuery): KrakenDepositsAdminUrlState {
  const { dateFrom, dateTo } = parseAdminDateRangeFromQuery(q)
  return {
    dateFrom,
    dateTo,
    currency: pickQueryStr(q, 'kdCcy') ?? '__all__',
    summaryColumnKey: pickQueryStr(q, 'kdSCol') === 'total' ? 'total' : 'currency',
    summaryDirection: parseDir(pickQueryStr(q, 'kdSDir'), 'asc'),
    depositsColumnKey: pickQueryStr(q, 'kdDepCol') ?? 'time',
    depositsDirection: parseDir(pickQueryStr(q, 'kdDepDir'), 'asc'),
  }
}

export function serializeKrakenDepositsAdminUrl(
  s: KrakenDepositsAdminUrlState
): Record<string, string> {
  return {
    from: s.dateFrom,
    to: s.dateTo,
    kdCcy: s.currency,
    kdSCol: s.summaryColumnKey,
    kdSDir: s.summaryDirection,
    kdDepCol: s.depositsColumnKey,
    kdDepDir: s.depositsDirection,
  }
}

// --- Kraken sell orders ---

export type KrakenSellOrdersAdminUrlState = {
  dateFrom: string
  dateTo: string
  summaryColumnKey: 'currency' | 'totalSold' | 'totalUsd' | 'totalFee'
  summaryDirection: SortDirection
  ordersColumnKey: string
  ordersDirection: SortDirection
}

export function parseKrakenSellOrdersAdminUrl(q: ParsedUrlQuery): KrakenSellOrdersAdminUrlState {
  const { dateFrom, dateTo } = parseAdminDateRangeFromQuery(q)
  const sk = pickQueryStr(q, 'koSCol')
  let summaryColumnKey: KrakenSellOrdersAdminUrlState['summaryColumnKey'] = 'currency'
  if (sk === 'totalSold' || sk === 'totalUsd' || sk === 'totalFee') summaryColumnKey = sk
  return {
    dateFrom,
    dateTo,
    summaryColumnKey,
    summaryDirection: parseDir(pickQueryStr(q, 'koSDir'), 'asc'),
    ordersColumnKey: pickQueryStr(q, 'koOrdCol') ?? 'time',
    ordersDirection: parseDir(pickQueryStr(q, 'koOrdDir'), 'asc'),
  }
}

export function serializeKrakenSellOrdersAdminUrl(
  s: KrakenSellOrdersAdminUrlState
): Record<string, string> {
  return {
    from: s.dateFrom,
    to: s.dateTo,
    koSCol: s.summaryColumnKey,
    koSDir: s.summaryDirection,
    koOrdCol: s.ordersColumnKey,
    koOrdDir: s.ordersDirection,
  }
}
