import { useMemo } from 'react'
import dayjs from 'dayjs'
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { FUND_CHART_FILL, FUND_STACK_KEYS, funds, type FundStackKey } from '../../utils/funds'

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

type ChartRecord = {
  paymentReceivedAt: Date
  source: string
  fundSlug: string | null
  cryptoAmount: string
  rate: string
  fiatAmount: number
}

function amountUsd(r: ChartRecord): number {
  return r.source === 'stripe' ? r.fiatAmount : Number(r.cryptoAmount) * Number(r.rate)
}

function fundStackKey(slug: string | null): FundStackKey {
  if (!slug || slug === '__unknown__') return 'unknown'
  if (slug in funds) return slug as FundStackKey
  return 'unknown'
}

function useMonthBuckets(dateFrom: string, dateTo: string): boolean {
  return dayjs(dateTo).diff(dayjs(dateFrom), 'month') >= 2
}

function bucketKeys(dateFrom: string, dateTo: string, byMonth: boolean): string[] {
  const start = dayjs(dateFrom)
  const end = dayjs(dateTo)
  if (byMonth) {
    const keys: string[] = []
    let cur = start.startOf('month')
    const endM = end.endOf('month')
    while (cur.isBefore(endM) || cur.isSame(endM, 'month')) {
      keys.push(cur.format('YYYY-MM'))
      cur = cur.add(1, 'month')
    }
    return keys
  }
  const keys: string[] = []
  let cur = start.startOf('day')
  const last = end.startOf('day')
  while (cur.isBefore(last) || cur.isSame(last, 'day')) {
    keys.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }
  return keys
}

function formatBucketLabel(bucket: string, byMonth: boolean): string {
  if (byMonth) {
    return dayjs(bucket + '-01').format('MMM YYYY')
  }
  return dayjs(bucket).format('MMM D')
}

type Row = {
  bucket: string
  label: string
} & Record<FundStackKey, number>

function buildRows(
  dateFrom: string,
  dateTo: string,
  records: ChartRecord[],
  byMonth: boolean
): { amountData: Row[]; countData: Row[] } {
  const keys = bucketKeys(dateFrom, dateTo, byMonth)
  const amountMap = new Map<string, Row>()
  const countMap = new Map<string, Row>()

  for (const k of keys) {
    const label = formatBucketLabel(k, byMonth)
    const empty: Row = {
      bucket: k,
      label,
      monero: 0,
      firo: 0,
      privacyguides: 0,
      general: 0,
      unknown: 0,
    }
    amountMap.set(k, { ...empty })
    countMap.set(k, { ...empty })
  }

  for (const r of records) {
    const d = dayjs(r.paymentReceivedAt)
    const bucket = byMonth ? d.format('YYYY-MM') : d.format('YYYY-MM-DD')
    if (!amountMap.has(bucket)) continue
    const fk = fundStackKey(r.fundSlug)
    const a = amountMap.get(bucket)!
    const c = countMap.get(bucket)!
    a[fk] += amountUsd(r)
    c[fk] += 1
  }

  const order = keys.map((k) => amountMap.get(k)!)
  return { amountData: order, countData: keys.map((k) => countMap.get(k)!) }
}

function legendLabel(key: string): string {
  if (key === 'unknown') return 'Unknown'
  const f = funds[key as keyof typeof funds]
  return f ? f.title.replace(' Fund', '') : key
}

type Props = {
  dateFrom: string
  dateTo: string
  records: ChartRecord[]
}

export function AccountingDonationCharts({ dateFrom, dateTo, records }: Props) {
  const byMonth = useMonthBuckets(dateFrom, dateTo)
  const { amountData, countData } = useMemo(
    () => buildRows(dateFrom, dateTo, records, byMonth),
    [dateFrom, dateTo, records, byMonth]
  )

  const xAxisProps = useMemo(
    () =>
      amountData.length > 24
        ? {
            angle: -45,
            textAnchor: 'end' as const,
            height: 72,
            tick: { fontSize: 11 },
            interval: 0,
          }
        : {
            tick: { fontSize: 12 },
            interval: 0,
          },
    [amountData.length]
  )

  /** Wider than viewport when many buckets so the chart scrolls horizontally on small screens. */
  const chartScrollWidthStyle = useMemo(() => {
    const n = Math.max(amountData.length, 1)
    return { width: `max(100%, ${n * 44}px)` as const }
  }, [amountData.length])

  const legendStyle = useMemo(
    () =>
      ({
        paddingBottom: 8,
        fontSize: '0.8rem',
        lineHeight: 1.25,
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-start',
        flexWrap: 'wrap',
        columnGap: 12,
        rowGap: 4,
      }) as const,
    []
  )

  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} {...xAxisProps} />
      <Legend
        verticalAlign="bottom"
        align="left"
        layout="horizontal"
        iconSize={10}
        wrapperStyle={legendStyle}
        formatter={(value) => legendLabel(String(value))}
      />
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Donation Amount (USD)</h2>
        <p className="text-muted-foreground text-sm">
          {byMonth ? 'By calendar month' : 'By day'} — {dayjs(dateFrom).format('MMM D, YYYY')} –{' '}
          {dayjs(dateTo).format('MMM D, YYYY')}
        </p>
        <div className="w-full min-w-0 overflow-x-auto rounded-md border bg-white p-2 shadow-sm">
          <div className="h-[320px]" style={chartScrollWidthStyle}>
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={amountData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
              {common}
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => usdFormat.format(Number(v))}
                width={64}
              />
              <Tooltip
                formatter={(value, name) => {
                  const n = Number(value ?? 0)
                  return [usdFormat.format(n), legendLabel(String(name ?? ''))]
                }}
                labelFormatter={(_, p) => (p?.[0]?.payload as Row | undefined)?.label ?? ''}
              />
              <BarStack>
                {FUND_STACK_KEYS.map((key) => (
                  <Bar key={key} dataKey={key} name={key} fill={FUND_CHART_FILL[key]} stackId="usd" />
                ))}
              </BarStack>
            </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Number of Donations</h2>
        <div className="w-full min-w-0 overflow-x-auto rounded-md border bg-white p-2 shadow-sm">
          <div className="h-[320px]" style={chartScrollWidthStyle}>
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={countData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
              {common}
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={48} />
              <Tooltip
                formatter={(value, name) => [
                  Number(value ?? 0),
                  legendLabel(String(name ?? '')),
                ]}
                labelFormatter={(_, p) => (p?.[0]?.payload as Row | undefined)?.label ?? ''}
              />
              <BarStack>
                {FUND_STACK_KEYS.map((key) => (
                  <Bar key={key} dataKey={key} name={key} fill={FUND_CHART_FILL[key]} stackId="n" />
                ))}
              </BarStack>
            </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
