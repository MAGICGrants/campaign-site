import type { ParsedUrlQuery } from 'querystring'
import { useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'

import type { SortDirection } from '../components/admin/sortable-table'
import {
  navSharedKeysPassthrough,
  parseAdminDateRangeFromQuery,
  persistAdminDateRange,
  pickQueryStr,
  tryReadSharedAdminDate,
} from '../utils/adminDateRange'
import {
  parseBtcpayAdminUrl,
  parseKrakenDepositsAdminUrl,
  parseKrakenSellOrdersAdminUrl,
  parseStripeInvoicesAdminUrl,
  serializeBtcpayAdminUrl,
  serializeKrakenDepositsAdminUrl,
  serializeKrakenSellOrdersAdminUrl,
  serializeStripeInvoicesAdminUrl,
  type BtcpayAdminUrlState,
  type KrakenDepositsAdminUrlState,
  type KrakenSellOrdersAdminUrlState,
  type StripeInvoicesAdminUrlState,
} from '../utils/adminTabQueries'

function flattenQuery(q: ParsedUrlQuery): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(q)) {
    if (typeof val === 'string' && val.length > 0) out[key] = val
    else if (Array.isArray(val) && typeof val[0] === 'string') out[key] = val[0]
  }
  return out
}

/** Restore `from`/`to` from session when URL has no date (all admin tabs except Accounting). */
export function useAdminDateQueryHydration() {
  const router = useRouter()

  useEffect(() => {
    if (!router.isReady) return
    if (router.pathname === '/admin/accounting') return

    if (pickQueryStr(router.query, 'from')) {
      const { dateFrom, dateTo } = parseAdminDateRangeFromQuery(router.query)
      persistAdminDateRange(dateFrom, dateTo)
      return
    }

    const restored = tryReadSharedAdminDate()
    if (!restored) return

    router.replace(
      {
        pathname: router.pathname,
        query: { ...flattenQuery(router.query), from: restored.from, to: restored.to },
      },
      undefined,
      { shallow: true }
    )
  }, [router, router.isReady, router.pathname, router.query])
}

const BTCPAY_SUMMARY_KEYS = ['fund', 'total'] as const
const BTCPAY_PAYMENT_KEYS = [
  'time',
  'fund',
  'project',
  'invoice',
  'amount',
  'rate',
  'static',
  'amountUsd',
] as const

export function useBtcpayAdminQuery() {
  const router = useRouter()

  const state = useMemo(() => parseBtcpayAdminUrl(router.query), [router.query])

  const patchQuery = useCallback(
    (patch: Partial<BtcpayAdminUrlState>) => {
      const next = { ...parseBtcpayAdminUrl(router.query), ...patch }
      persistAdminDateRange(next.dateFrom, next.dateTo)
      router.replace(
        { pathname: router.pathname, query: serializeBtcpayAdminUrl(next) },
        undefined,
        { shallow: true }
      )
    },
    [router]
  )

  useAdminDateQueryHydration()

  const summaryToggle = useCallback(
    (key: string) => {
      if (!(BTCPAY_SUMMARY_KEYS as readonly string[]).includes(key)) return
      const c = parseBtcpayAdminUrl(router.query)
      if (c.summaryColumnKey !== key) {
        patchQuery({ summaryColumnKey: key as 'fund' | 'total', summaryDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.summaryDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ summaryDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const paymentsToggle = useCallback(
    (key: string) => {
      if (!(BTCPAY_PAYMENT_KEYS as readonly string[]).includes(key)) return
      const c = parseBtcpayAdminUrl(router.query)
      if (c.paymentsColumnKey !== key) {
        patchQuery({ paymentsColumnKey: key, paymentsDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.paymentsDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ paymentsDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const summarySort = useMemo(
    () => ({
      columnKey: state.summaryColumnKey,
      direction: state.summaryDirection,
      toggle: summaryToggle,
    }),
    [state.summaryColumnKey, state.summaryDirection, summaryToggle]
  )

  const paymentsSort = useMemo(
    () => ({
      columnKey: state.paymentsColumnKey,
      direction: state.paymentsDirection,
      toggle: paymentsToggle,
    }),
    [state.paymentsColumnKey, state.paymentsDirection, paymentsToggle]
  )

  return { state, patchQuery, summarySort, paymentsSort }
}

const STRIPE_SUMMARY_KEYS = ['fund', 'amount', 'fee', 'net'] as const
const STRIPE_INV_KEYS = ['time', 'fund', 'project', 'payment', 'amount', 'fee', 'net', 'recurring'] as const

export function useStripeInvoicesAdminQuery() {
  const router = useRouter()
  const state = useMemo(() => parseStripeInvoicesAdminUrl(router.query), [router.query])

  const patchQuery = useCallback(
    (patch: Partial<StripeInvoicesAdminUrlState>) => {
      const next = { ...parseStripeInvoicesAdminUrl(router.query), ...patch }
      persistAdminDateRange(next.dateFrom, next.dateTo)
      router.replace(
        { pathname: router.pathname, query: serializeStripeInvoicesAdminUrl(next) },
        undefined,
        { shallow: true }
      )
    },
    [router]
  )

  useAdminDateQueryHydration()

  const summaryToggle = useCallback(
    (key: string) => {
      if (!(STRIPE_SUMMARY_KEYS as readonly string[]).includes(key)) return
      const c = parseStripeInvoicesAdminUrl(router.query)
      if (c.summaryColumnKey !== key) {
        patchQuery({
          summaryColumnKey: key as StripeInvoicesAdminUrlState['summaryColumnKey'],
          summaryDirection: 'asc',
        })
      } else {
        const nextDir: SortDirection = c.summaryDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ summaryDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const invoicesToggle = useCallback(
    (key: string) => {
      if (!(STRIPE_INV_KEYS as readonly string[]).includes(key)) return
      const c = parseStripeInvoicesAdminUrl(router.query)
      if (c.invoicesColumnKey !== key) {
        patchQuery({ invoicesColumnKey: key, invoicesDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.invoicesDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ invoicesDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const summarySort = useMemo(
    () => ({
      columnKey: state.summaryColumnKey,
      direction: state.summaryDirection,
      toggle: summaryToggle,
    }),
    [state.summaryColumnKey, state.summaryDirection, summaryToggle]
  )

  const invoicesSort = useMemo(
    () => ({
      columnKey: state.invoicesColumnKey,
      direction: state.invoicesDirection,
      toggle: invoicesToggle,
    }),
    [state.invoicesColumnKey, state.invoicesDirection, invoicesToggle]
  )

  return { state, patchQuery, summarySort, invoicesSort }
}

const KD_SUMMARY_KEYS = ['currency', 'total'] as const
const KD_DEP_KEYS = ['time', 'amount', 'depositId', 'txHash'] as const

export function useKrakenDepositsAdminQuery() {
  const router = useRouter()
  const state = useMemo(() => parseKrakenDepositsAdminUrl(router.query), [router.query])

  const patchQuery = useCallback(
    (patch: Partial<KrakenDepositsAdminUrlState>) => {
      const next = { ...parseKrakenDepositsAdminUrl(router.query), ...patch }
      persistAdminDateRange(next.dateFrom, next.dateTo)
      router.replace(
        {
          pathname: router.pathname,
          query: {
            ...navSharedKeysPassthrough(router.query),
            ...serializeKrakenDepositsAdminUrl(next),
          },
        },
        undefined,
        { shallow: true }
      )
    },
    [router]
  )

  useAdminDateQueryHydration()

  const summaryToggle = useCallback(
    (key: string) => {
      if (!(KD_SUMMARY_KEYS as readonly string[]).includes(key)) return
      const c = parseKrakenDepositsAdminUrl(router.query)
      if (c.summaryColumnKey !== key) {
        patchQuery({ summaryColumnKey: key as 'currency' | 'total', summaryDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.summaryDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ summaryDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const depositsToggle = useCallback(
    (key: string) => {
      if (!(KD_DEP_KEYS as readonly string[]).includes(key)) return
      const c = parseKrakenDepositsAdminUrl(router.query)
      if (c.depositsColumnKey !== key) {
        patchQuery({ depositsColumnKey: key, depositsDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.depositsDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ depositsDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const summarySort = useMemo(
    () => ({
      columnKey: state.summaryColumnKey,
      direction: state.summaryDirection,
      toggle: summaryToggle,
    }),
    [state.summaryColumnKey, state.summaryDirection, summaryToggle]
  )

  const depositsSort = useMemo(
    () => ({
      columnKey: state.depositsColumnKey,
      direction: state.depositsDirection,
      toggle: depositsToggle,
    }),
    [state.depositsColumnKey, state.depositsDirection, depositsToggle]
  )

  return { state, patchQuery, summarySort, depositsSort }
}

const KO_SUMMARY_KEYS = ['currency', 'totalSold', 'totalUsd', 'totalFee'] as const
const KO_ORD_KEYS = ['time', 'amount', 'execAmount', 'fee', 'orderId'] as const

export function useKrakenSellOrdersAdminQuery() {
  const router = useRouter()
  const state = useMemo(() => parseKrakenSellOrdersAdminUrl(router.query), [router.query])

  const patchQuery = useCallback(
    (patch: Partial<KrakenSellOrdersAdminUrlState>) => {
      const next = { ...parseKrakenSellOrdersAdminUrl(router.query), ...patch }
      persistAdminDateRange(next.dateFrom, next.dateTo)
      router.replace(
        {
          pathname: router.pathname,
          query: {
            ...navSharedKeysPassthrough(router.query),
            ...serializeKrakenSellOrdersAdminUrl(next),
          },
        },
        undefined,
        { shallow: true }
      )
    },
    [router]
  )

  useAdminDateQueryHydration()

  const summaryToggle = useCallback(
    (key: string) => {
      if (!(KO_SUMMARY_KEYS as readonly string[]).includes(key)) return
      const c = parseKrakenSellOrdersAdminUrl(router.query)
      if (c.summaryColumnKey !== key) {
        patchQuery({
          summaryColumnKey: key as KrakenSellOrdersAdminUrlState['summaryColumnKey'],
          summaryDirection: 'asc',
        })
      } else {
        const nextDir: SortDirection = c.summaryDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ summaryDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const ordersToggle = useCallback(
    (key: string) => {
      if (!(KO_ORD_KEYS as readonly string[]).includes(key)) return
      const c = parseKrakenSellOrdersAdminUrl(router.query)
      if (c.ordersColumnKey !== key) {
        patchQuery({ ordersColumnKey: key, ordersDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.ordersDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ ordersDirection: nextDir })
      }
    },
    [router.query, patchQuery]
  )

  const summarySort = useMemo(
    () => ({
      columnKey: state.summaryColumnKey,
      direction: state.summaryDirection,
      toggle: summaryToggle,
    }),
    [state.summaryColumnKey, state.summaryDirection, summaryToggle]
  )

  const ordersSort = useMemo(
    () => ({
      columnKey: state.ordersColumnKey,
      direction: state.ordersDirection,
      toggle: ordersToggle,
    }),
    [state.ordersColumnKey, state.ordersDirection, ordersToggle]
  )

  return { state, patchQuery, summarySort, ordersSort }
}
