import { useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'

import type { SortDirection } from '../components/admin/sortable-table'
import {
  DONATIONS_SORT_KEYS,
  hasAccountingUrlParams,
  parseAccountingPageQuery,
  persistAccountingQuerySession,
  readAccountingQuerySession,
  serializeAccountingPageQuery,
  SUMMARY_SORT_KEYS,
  type AccountingPageQueryState,
  type DonationsSortKey,
  type SummarySortKey,
} from '../utils/accountingPageQuery'

export function useAccountingPageQuery(allowedFundSelectValues: Set<string>) {
  const router = useRouter()

  const state = useMemo(
    () => parseAccountingPageQuery(router.query, { allowedFundSelectValues }),
    [router.query, allowedFundSelectValues]
  )

  useEffect(() => {
    if (!router.isReady) return

    if (hasAccountingUrlParams(router.query)) {
      const current = parseAccountingPageQuery(router.query, { allowedFundSelectValues })
      persistAccountingQuerySession(serializeAccountingPageQuery(current))
      return
    }

    const stored = readAccountingQuerySession()
    if (!stored) return

    const restored = parseAccountingPageQuery(stored, { allowedFundSelectValues })
    router.replace(
      { pathname: router.pathname, query: serializeAccountingPageQuery(restored) },
      undefined,
      { shallow: true }
    )
  }, [router, router.isReady, router.pathname, router.query, allowedFundSelectValues])

  const patchQuery = useCallback(
    (patch: Partial<AccountingPageQueryState>) => {
      const current = parseAccountingPageQuery(router.query, { allowedFundSelectValues })
      const next = { ...current, ...patch }
      const serialized = serializeAccountingPageQuery(next)
      persistAccountingQuerySession(serialized)
      router.replace({ pathname: router.pathname, query: serialized }, undefined, { shallow: true })
    },
    [router, allowedFundSelectValues]
  )

  const summaryToggle = useCallback(
    (key: string) => {
      if (!(SUMMARY_SORT_KEYS as readonly string[]).includes(key)) return
      const c = parseAccountingPageQuery(router.query, { allowedFundSelectValues })
      if (c.summaryColumnKey !== key) {
        patchQuery({ summaryColumnKey: key as SummarySortKey, summaryDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.summaryDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ summaryDirection: nextDir })
      }
    },
    [router.query, allowedFundSelectValues, patchQuery]
  )

  const donationsToggle = useCallback(
    (key: string) => {
      if (!(DONATIONS_SORT_KEYS as readonly string[]).includes(key)) return
      const c = parseAccountingPageQuery(router.query, { allowedFundSelectValues })
      if (c.donationsColumnKey !== key) {
        patchQuery({ donationsColumnKey: key as DonationsSortKey, donationsDirection: 'asc' })
      } else {
        const nextDir: SortDirection = c.donationsDirection === 'asc' ? 'desc' : 'asc'
        patchQuery({ donationsDirection: nextDir })
      }
    },
    [router.query, allowedFundSelectValues, patchQuery]
  )

  const summarySort = useMemo(
    () => ({
      columnKey: state.summaryColumnKey,
      direction: state.summaryDirection,
      toggle: summaryToggle,
    }),
    [state.summaryColumnKey, state.summaryDirection, summaryToggle]
  )

  const donationsSort = useMemo(
    () => ({
      columnKey: state.donationsColumnKey,
      direction: state.donationsDirection,
      toggle: donationsToggle,
    }),
    [state.donationsColumnKey, state.donationsDirection, donationsToggle]
  )

  return {
    state,
    patchQuery,
    summarySort,
    donationsSort,
  }
}
