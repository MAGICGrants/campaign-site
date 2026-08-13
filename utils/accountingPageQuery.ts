import type { ParsedUrlQuery } from 'querystring'

import type { DonationSource } from '@prisma/client'

import { defaultMonthDateRange } from '../components/admin/AdminDateRangePicker'
import type { SortDirection } from '../components/admin/sortable-table'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Query keys owned by the accounting page (URL + session restore). */
export const ACCOUNTING_URL_QUERY_KEYS = [
  'from',
  'to',
  'fund',
  'project',
  'sources',
  'sumCol',
  'sumDir',
  'donCol',
  'donDir',
] as const

const SESSION_STORAGE_KEY = 'campaign-site:admin-accounting:v1'

export function hasAccountingUrlParams(q: ParsedUrlQuery): boolean {
  return ACCOUNTING_URL_QUERY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(q, k))
}

/** Persist serialized accounting query for restore when navigating back without a query string. */
export function persistAccountingQuerySession(query: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(query))
  } catch {
    // ignore quota / private mode
  }
}

/** Read last serialized query from session, or null if missing/invalid. */
export function readAccountingQuerySession(): Record<string, string> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    if (typeof o.from !== 'string' || typeof o.to !== 'string') return null
    return o as Record<string, string>
  } catch {
    return null
  }
}

export const SUMMARY_SORT_KEYS = ['fund', 'invoiceSum', 'depositSum', 'difference'] as const
export type SummarySortKey = (typeof SUMMARY_SORT_KEYS)[number]

export const DONATIONS_SORT_KEYS = [
  'time',
  'source',
  'fund',
  'project',
  'invoice',
  'amount',
  'amountUsd',
  'netAmount',
  'netUsd',
  'deposits',
  'orders',
  'realized',
] as const
export type DonationsSortKey = (typeof DONATIONS_SORT_KEYS)[number]

const DONATION_SOURCES: DonationSource[] = ['btcpayserver', 'coinbase', 'stripe']

export type AccountingPageQueryState = {
  dateFrom: string
  dateTo: string
  fund: string
  project: string
  sources: DonationSource[]
  summaryColumnKey: SummarySortKey
  summaryDirection: SortDirection
  donationsColumnKey: DonationsSortKey
  donationsDirection: SortDirection
}

const DEFAULT_SOURCES: DonationSource[] = ['btcpayserver', 'coinbase']

function pickStr(q: ParsedUrlQuery, key: string): string | undefined {
  const v = q[key]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}

function parseIsoDate(s: string | undefined, fallback: string): string {
  if (s && ISO_DATE.test(s)) return s
  return fallback
}

function parseSourcesFromQuery(q: ParsedUrlQuery): DonationSource[] {
  const keyPresent = Object.prototype.hasOwnProperty.call(q, 'sources')
  const s = pickStr(q, 'sources')
  if (!keyPresent) return [...DEFAULT_SOURCES]
  if (s === '' || s == null) return []
  const parts = s.split(',').map((x) => x.trim())
  const out = parts.filter((p): p is DonationSource =>
    DONATION_SOURCES.includes(p as DonationSource)
  )
  return out
}

function parseSummaryKey(s: string | undefined): SummarySortKey {
  if (s && (SUMMARY_SORT_KEYS as readonly string[]).includes(s)) return s as SummarySortKey
  return 'fund'
}

function parseDonationsKey(s: string | undefined): DonationsSortKey {
  if (s && (DONATIONS_SORT_KEYS as readonly string[]).includes(s)) return s as DonationsSortKey
  return 'time'
}

function parseDir(s: string | undefined, fallback: SortDirection): SortDirection {
  return s === 'desc' ? 'desc' : s === 'asc' ? 'asc' : fallback
}

/** Parse Next.js `router.query` into accounting page state. */
export function parseAccountingPageQuery(
  q: ParsedUrlQuery,
  options?: { allowedFundSelectValues?: Set<string> }
): AccountingPageQueryState {
  const def = defaultMonthDateRange()
  let fund = pickStr(q, 'fund') ?? '__all__'
  const allowed = options?.allowedFundSelectValues
  if (allowed && !allowed.has(fund)) {
    fund = '__all__'
  }

  let project = pickStr(q, 'project') ?? '__all__'
  if (project !== '__all__' && project !== '__unknown__' && project.length > 200) {
    project = '__all__'
  }

  return {
    dateFrom: parseIsoDate(pickStr(q, 'from'), def.dateFrom),
    dateTo: parseIsoDate(pickStr(q, 'to'), def.dateTo),
    fund,
    project,
    sources: parseSourcesFromQuery(q),
    summaryColumnKey: parseSummaryKey(pickStr(q, 'sumCol')),
    summaryDirection: parseDir(pickStr(q, 'sumDir'), 'asc'),
    donationsColumnKey: parseDonationsKey(pickStr(q, 'donCol')),
    donationsDirection: parseDir(pickStr(q, 'donDir'), 'asc'),
  }
}

function serializeSources(sources: DonationSource[]): string {
  return [...sources].sort().join(',')
}

/** Serialize state for `router.replace({ query })` (all string values). */
export function serializeAccountingPageQuery(state: AccountingPageQueryState): Record<string, string> {
  return {
    from: state.dateFrom,
    to: state.dateTo,
    fund: state.fund,
    project: state.project,
    sources: serializeSources(state.sources),
    sumCol: state.summaryColumnKey,
    sumDir: state.summaryDirection,
    donCol: state.donationsColumnKey,
    donDir: state.donationsDirection,
  }
}
