import { useEffect, useRef, useState } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { CalendarIcon } from 'lucide-react'

import { Button } from '../ui/button'
import { Calendar } from '../ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ADMIN_DATE_RANGE_MAX_DAYS, clampDateRange } from '../../utils/adminDateRange'
import { cn } from '../../utils/cn'

export { ADMIN_DATE_RANGE_MAX_DAYS } from '../../utils/adminDateRange'

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseLocalYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function defaultMonthDateRange(d = new Date()): { dateFrom: string; dateTo: string } {
  const from = new Date(d.getFullYear(), d.getMonth(), 1)
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { dateFrom: formatLocalYmd(from), dateTo: formatLocalYmd(to) }
}

type AdminDateRangePickerProps = {
  dateFrom: string
  dateTo: string
  onRangeChange: (dateFrom: string, dateTo: string) => void
  className?: string
  align?: 'start' | 'center' | 'end'
}

export function AdminDateRangePicker({
  dateFrom,
  dateTo,
  onRangeChange,
  className,
  align = 'start',
}: AdminDateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = parseLocalYmd(dateFrom)
    const to = parseLocalYmd(dateTo)
    const c = clampDateRange(from, to)
    return { from: c.from, to: c.to }
  })
  const rangeRef = useRef(range)
  rangeRef.current = range

  useEffect(() => {
    if (!open) {
      const from = parseLocalYmd(dateFrom)
      const to = parseLocalYmd(dateTo)
      const c = clampDateRange(from, to)
      setRange({ from: c.from, to: c.to })
    }
  }, [dateFrom, dateTo, open])

  useEffect(() => {
    const from = parseLocalYmd(dateFrom)
    const to = parseLocalYmd(dateTo)
    const c = clampDateRange(from, to)
    const nf = formatLocalYmd(c.from)
    const nt = formatLocalYmd(c.to)
    if (nf !== dateFrom || nt !== dateTo) {
      onRangeChange(nf, nt)
    }
  }, [dateFrom, dateTo, onRangeChange])

  const label = `${format(parseLocalYmd(dateFrom), 'MMM d, yyyy')} – ${format(parseLocalYmd(dateTo), 'MMM d, yyyy')}`

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          const cur = rangeRef.current
          if (cur?.from && !cur.to) {
            const d = formatLocalYmd(cur.from)
            onRangeChange(d, d)
            setRange({ from: cur.from, to: cur.from })
          }
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'h-9 min-w-[min(100%,16rem)] justify-start border-input bg-white px-3 py-2 text-left text-sm font-normal text-foreground shadow-none',
            'hover:bg-white hover:text-foreground',
            'focus-visible:border-primary focus-visible:ring-0',
            className
          )}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="range"
          defaultMonth={range?.from}
          selected={range}
          onSelect={(r) => {
            setRange(r)
            if (r?.from && r?.to) {
              const c = clampDateRange(r.from, r.to)
              setRange({ from: c.from, to: c.to })
              onRangeChange(formatLocalYmd(c.from), formatLocalYmd(c.to))
            }
          }}
          disabled={(date) => {
            if (!range?.from || range.to) return false
            return differenceInCalendarDays(date, range.from) > ADMIN_DATE_RANGE_MAX_DAYS
          }}
          numberOfMonths={2}
          className="rounded-lg"
        />
      </PopoverContent>
    </Popover>
  )
}
