import { useCallback, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { TableHead } from '../ui/table'
import { cn } from '../../utils/cn'

export type SortDirection = 'asc' | 'desc'

export function useSortableColumn(defaultKey: string, defaultDir: SortDirection = 'asc') {
  const [columnKey, setColumnKey] = useState(defaultKey)
  const [direction, setDirection] = useState<SortDirection>(defaultDir)
  const toggle = useCallback(
    (key: string) => {
      if (columnKey !== key) {
        setColumnKey(key)
        setDirection('asc')
      } else {
        setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
      }
    },
    [columnKey]
  )
  return { columnKey, direction, toggle } as const
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null || a === '') return 1
  if (b == null || b === '') return -1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0
    if (Number.isNaN(a)) return 1
    if (Number.isNaN(b)) return -1
    return a - b
  }
  const na = typeof a === 'number' ? a : Number(a)
  const nb = typeof b === 'number' ? b : Number(b)
  if (
    !Number.isNaN(na) &&
    !Number.isNaN(nb) &&
    String(a).trim() !== '' &&
    String(b).trim() !== '' &&
    typeof a !== 'boolean' &&
    typeof b !== 'boolean'
  ) {
    return na - nb
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows<T>(
  rows: T[],
  columnKey: string,
  direction: SortDirection,
  accessors: Record<string, (row: T) => unknown>
): T[] {
  const getter = accessors[columnKey]
  if (!getter) return rows
  const copy = [...rows]
  const mult = direction === 'asc' ? 1 : -1
  copy.sort((a, b) => compareValues(getter(a), getter(b)) * mult)
  return copy
}

type SortableTableHeadProps = {
  columnKey: string
  currentKey: string
  direction: SortDirection
  onToggle: (key: string) => void
  children: ReactNode
  className?: string
}

export function SortableTableHead({
  columnKey,
  currentKey,
  direction,
  onToggle,
  children,
  className,
}: SortableTableHeadProps) {
  const active = currentKey === columnKey
  return (
    <TableHead className={cn('text-foreground min-w-min', className)}>
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className="-mx-1 box-border inline-flex w-max cursor-pointer items-center justify-start rounded px-2 py-0.5 text-left font-medium hover:bg-muted/50"
      >
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span>{children}</span>
          {active ? (
            direction === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
          )}
        </span>
      </button>
    </TableHead>
  )
}
