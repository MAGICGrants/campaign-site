import { useState, useMemo } from 'react'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import utc from 'dayjs/plugin/utc'
import Head from 'next/head'

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Copy, Download } from 'lucide-react'

import {
  SortableTableHead,
  sortRows,
  useSortableColumn,
} from '../../components/admin/sortable-table'
import { AdminDateRangePicker, defaultMonthDateRange } from '../../components/admin/AdminDateRangePicker'
import { Button } from '../../components/ui/button'
import { trpc } from '../../utils/trpc'

dayjs.extend(localizedFormat)
dayjs.extend(utc)

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

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
  const [{ dateFrom, dateTo }, setDateRange] = useState(defaultMonthDateRange)

  const listOrdersQuery = trpc.accounting.listKrakenSellOrdersByDateRange.useQuery(
    { dateFrom, dateTo },
    { enabled: !!dateFrom && !!dateTo }
  )

  const orders = listOrdersQuery.data ?? []

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
    return Array.from(byCurrency.entries()).map(([cryptoCode, data]) => ({ cryptoCode, ...data }))
  }, [orders])

  const summarySort = useSortableColumn('currency')
  const sortedSummary = useMemo(
    () =>
      sortRows(
        summary,
        summarySort.columnKey,
        summarySort.direction,
        {
          currency: (r) => r.cryptoCode,
          totalSold: (r) => r.volExec,
          totalUsd: (r) => r.cost,
          totalFee: (r) => r.fee,
        }
      ),
    [summary, summarySort.columnKey, summarySort.direction]
  )

  const ordersSort = useSortableColumn('time')
  const sortedOrders = useMemo(
    () =>
      sortRows(
        orders,
        ordersSort.columnKey,
        ordersSort.direction,
        {
          time: (r) => r.closedAt,
          amount: (r) => r.vol,
          execAmount: (r) => r.volExec,
          fee: (r) => r.fee,
          orderId: (r) => r.orderId,
        }
      ),
    [orders, ordersSort.columnKey, ordersSort.direction]
  )

  return (
    <>
      <Head>
        <title>Kraken Sell Orders</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Kraken Sell Orders</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end">
          <AdminDateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
            className="w-full sm:w-[280px]"
          />
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
                    <SortableTableHead
                      columnKey="currency"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Currency
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="totalSold"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Total Sold
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="totalUsd"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Total USD
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="totalFee"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Total Fee
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSummary.map((row) => (
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
                  <SortableTableHead
                    columnKey="time"
                    currentKey={ordersSort.columnKey}
                    direction={ordersSort.direction}
                    onToggle={ordersSort.toggle}
                  >
                    Time
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="amount"
                    currentKey={ordersSort.columnKey}
                    direction={ordersSort.direction}
                    onToggle={ordersSort.toggle}
                  >
                    Amount
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="execAmount"
                    currentKey={ordersSort.columnKey}
                    direction={ordersSort.direction}
                    onToggle={ordersSort.toggle}
                  >
                    Exec Amount
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="fee"
                    currentKey={ordersSort.columnKey}
                    direction={ordersSort.direction}
                    onToggle={ordersSort.toggle}
                  >
                    Fee
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="orderId"
                    currentKey={ordersSort.columnKey}
                    direction={ordersSort.direction}
                    onToggle={ordersSort.toggle}
                  >
                    Order ID
                  </SortableTableHead>
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
                      No sell orders for this date range
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedOrders.map((record) => {
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
