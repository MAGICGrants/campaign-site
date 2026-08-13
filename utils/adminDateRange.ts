import type { ParsedUrlQuery } from 'querystring'

import { differenceInCalendarDays, subDays } from 'date-fns'

import { defaultMonthDateRange } from '../components/admin/AdminDateRangePicker'

import { readAccountingQuerySession } from './accountingPageQuery'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Max calendar-day gap between range endpoints (matches server `adminDateRangeSchema`). */
export const ADMIN_DATE_RANGE_MAX_DAYS = 365

export function clampDateRange(from: Date, to: Date): { from: Date; to: Date } {
  let f = from
  let t = to
  if (t < f) {
    f = to
    t = from
  }
  if (differenceInCalendarDays(t, f) <= ADMIN_DATE_RANGE_MAX_DAYS) {
    return { from: f, to: t }
  }
  return { from: subDays(t, ADMIN_DATE_RANGE_MAX_DAYS), to: t }
}

/** Shared across admin accounting tabs (`from` / `to` in URL + session fallback). */
export const ADMIN_DATE_SESSION_KEY = 'campaign-site:admin-shared-date:v1'

export function pickQueryStr(q: ParsedUrlQuery, key: string): string | undefined {
  const v = q[key]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}

export function parseIsoDateParam(s: string | undefined, fallback: string): string {
  if (s && ISO_DATE.test(s)) return s
  return fallback
}

export function parseAdminDateRangeFromQuery(q: ParsedUrlQuery): { dateFrom: string; dateTo: string } {
  const def = defaultMonthDateRange()
  return {
    dateFrom: parseIsoDateParam(pickQueryStr(q, 'from'), def.dateFrom),
    dateTo: parseIsoDateParam(pickQueryStr(q, 'to'), def.dateTo),
  }
}

export function persistAdminDateRange(dateFrom: string, dateTo: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(ADMIN_DATE_SESSION_KEY, JSON.stringify({ from: dateFrom, to: dateTo }))
  } catch {
    // ignore
  }
}

function readAdminDateOnlySession(): { from: string; to: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(ADMIN_DATE_SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    if (typeof o.from !== 'string' || typeof o.to !== 'string') return null
    return { from: o.from, to: o.to }
  } catch {
    return null
  }
}

/** Last saved admin date range, or `from`/`to` from full accounting session backup. */
export function tryReadSharedAdminDate(): { from: string; to: string } | null {
  const direct = readAdminDateOnlySession()
  if (direct) return direct
  const ac = readAccountingQuerySession()
  if (ac?.from && ac?.to) return { from: ac.from, to: ac.to }
  return null
}

/** Keep `fund` / `project` in the URL for tab nav even on pages that do not use them. */
const NAV_PASSTHROUGH_KEYS = ['fund', 'project'] as const

export function navSharedKeysPassthrough(q: ParsedUrlQuery): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of NAV_PASSTHROUGH_KEYS) {
    const v = pickQueryStr(q, k)
    if (v) out[k] = v
  }
  return out
}
