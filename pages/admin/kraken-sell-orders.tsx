import { useState, useMemo } from 'react'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import utc from 'dayjs/plugin/utc'
import Head from 'next/head'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Copy, Download } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { trpc } from '../../utils/trpc'

dayjs.extend(localizedFormat)
dayjs.extend(utc)

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatMonthOption(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function escapeCsvValue(value: string | number): string {
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

type KrakenSellOrderItem = {
  orderId: string
  pair: string
  cryptoCode: string
  vol: number
  volExec: number
  cost: number
  fee: number
  netProceeds: number
  closedAt: Date
}

function formatBaseAndUsd(amountBase: number, amountUsd: number, cryptoCode: string): string {
  const decimals = cryptoCode === 'USDC' ? 2 : 8
  return `${amountBase.toFixed(decimals)} ${cryptoCode} (${usdFormat.format(amountUsd)})`
}

function exportToCsv(records: KrakenSellOrderItem[]) {
  const headers = ['time', 'amountBase', 'amountUsd', 'execAmountBase', 'execAmountUsd', 'fee', 'orderId']
  const rows = records.map((record) => {
    const amountUsd = record.volExec > 0 ? (record.vol / record.volExec) * record.cost : 0
    return [
      dayjs(record.closedAt).format('YYYY-MM-DD HH:mm:ss') + ' UTC',
      record.vol,
      record.cost,
      record.volExec,
      record.cost,
      record.fee,
      record.orderId,
    ]
  })
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kraken-sell-orders-${dayjs().format('YYYY-MM-DD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSummaryToCsv(
  records: { cryptoCode: string; volExec: number; cost: number; fee: number }[]
) {
  const headers = ['currency', 'totalSold', 'totalUsd', 'totalFee']
  const rows = records.map((row) => [
    row.cryptoCode,
    row.volExec,
    row.cost.toFixed(2),
    row.fee.toFixed(2),
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kraken-sell-orders-summary-${dayjs().format('YYYY-MM-DD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function CopyableText({ text, truncate = false }: { text: string; truncate?: boolean }) {
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
  }
  const displayText =
    truncate && text.length > 10 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span
        className={truncate ? 'font-mono text-xs truncate max-w-[140px]' : 'font-mono text-xs'}
        title={text}
      >
        {displayText}
      </span>
      <Button
        type="button"
        variant="light"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
        aria-label="Copy"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export default function KrakenSellOrdersPage() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    formatMonthOption(now.getFullYear(), now.getMonth() + 1)
  )

  const [year, month] = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    return [y, m] as [number, number]
  }, [selectedMonth])

  const listOrdersQuery = trpc.accounting.listKrakenSellOrdersByMonth.useQuery(
    { year, month },
    { enabled: !!year && !!month }
  )

  const orders = listOrdersQuery.data ?? []

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    const today = new Date()
    for (let i = 0; i < 24; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      opts.push({
        value: formatMonthOption(d.getFullYear(), d.getMonth() + 1),
        label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
      })
    }
    return opts
  }, [])

  const summary = useMemo(() => {
    const byCurrency = new Map<string, { volExec: number; cost: number; fee: number }>()
    for (const o of orders) {
      const existing = byCurrency.get(o.cryptoCode) ?? { volExec: 0, cost: 0, fee: 0 }
      byCurrency.set(o.cryptoCode, {
        volExec: existing.volExec + o.volExec,
        cost: existing.cost + o.cost,
        fee: existing.fee + o.fee,
      })
    }
    return Array.from(byCurrency.entries())
      .map(([cryptoCode, data]) => ({ cryptoCode, ...data }))
      .sort((a, b) => a.cryptoCode.localeCompare(b.cryptoCode))
  }, [orders])

  return (
    <>
      <Head>
        <title>Kraken Sell Orders</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Kraken Sell Orders</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end">
          <Select value={selectedMonth} onValueChange={(v) => setSelectedMonth(v)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {summary.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Summary</h2>
              <Button size="sm" onClick={() => exportSummaryToCsv(summary)}>
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
            </div>
            <div className="w-full overflow-x-auto rounded-md border bg-white shadow-sm">
              <Table className="w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-foreground">Currency</TableHead>
                    <TableHead className="text-foreground">Total Sold</TableHead>
                    <TableHead className="text-foreground">Total USD</TableHead>
                    <TableHead className="text-foreground">Total Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((row) => (
                    <TableRow key={row.cryptoCode}>
                      <TableCell>{row.cryptoCode}</TableCell>
                      <TableCell>
                        {row.volExec.toFixed(row.cryptoCode === 'USDC' ? 2 : 8)} {row.cryptoCode}
                      </TableCell>
                      <TableCell>{usdFormat.format(row.cost)}</TableCell>
                      <TableCell>{usdFormat.format(row.fee)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sell Orders</h2>
            <Button
              size="sm"
              onClick={() => exportToCsv(orders)}
              disabled={orders.length === 0}
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
          <div className="w-full min-w-0 overflow-x-auto overflow-hidden rounded-md border bg-white shadow-sm">
            <Table className="min-w-[800px] w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Time</TableHead>
                  <TableHead className="text-foreground">Amount</TableHead>
                  <TableHead className="text-foreground">Exec Amount</TableHead>
                  <TableHead className="text-foreground">Fee</TableHead>
                  <TableHead className="text-foreground">Order ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listOrdersQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No sell orders for this month
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((record) => {
                    const amountUsd = record.volExec > 0 ? (record.vol / record.volExec) * record.cost : 0
                    return (
                      <TableRow key={record.orderId}>
                        <TableCell>{dayjs(record.closedAt).format('lll')}</TableCell>
                        <TableCell>
                          {formatBaseAndUsd(record.vol, amountUsd, record.cryptoCode)}
                        </TableCell>
                        <TableCell>
                          {formatBaseAndUsd(record.volExec, record.cost, record.cryptoCode)}
                        </TableCell>
                        <TableCell>{usdFormat.format(record.fee)}</TableCell>
                        <TableCell>
                          <CopyableText text={record.orderId} truncate />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  )
}
