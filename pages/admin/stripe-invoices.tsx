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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Copy, Download } from 'lucide-react'

import { FundBadge } from '../../components/admin/FundBadge'
import { AdminDateRangePicker, defaultMonthDateRange } from '../../components/admin/AdminDateRangePicker'
import {
  SortableTableHead,
  sortRows,
  useSortableColumn,
} from '../../components/admin/sortable-table'
import { Button } from '../../components/ui/button'
import { trpc } from '../../utils/trpc'
import { funds } from '../../utils/funds'
import type { StripeInvoiceItem } from '../../server/types'

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

function exportToCsv(records: StripeInvoiceItem[]) {
  const headers = [
    'time',
    'fund',
    'project',
    'paymentId',
    'invoiceId',
    'grossAmount',
    'fee',
    'netAmount',
    'isRecurring',
  ]
  const rows = records.map((record) => [
    dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss') + ' UTC',
    funds[record.fundSlug as keyof typeof funds]?.title?.replace(' Fund', '') ?? record.fundSlug,
    record.projectName,
    record.paymentId,
    record.invoiceId ?? '',
    record.grossFiatAmount.toFixed(2),
    record.fee.toFixed(2),
    record.netFiatAmount.toFixed(2),
    record.isRecurring ? 'Yes' : 'No',
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `stripe-invoices-${dayjs().format('YYYY-MM-DD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSummaryToCsv(
  records: { fundSlug: string; fundTitle: string; grossSum: number; feeSum: number; netSum: number }[]
) {
  const headers = ['fund', 'grossSum', 'feeSum', 'netSum']
  const rows = records.map((row) => [
    row.fundTitle,
    row.grossSum.toFixed(2),
    row.feeSum.toFixed(2),
    row.netSum.toFixed(2),
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `stripe-invoices-summary-${dayjs().format('YYYY-MM-DD')}.csv`
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

export default function StripeInvoicesPage() {
  const [{ dateFrom, dateTo }, setDateRange] = useState(defaultMonthDateRange)
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [selectedFund, setSelectedFund] = useState<string>('__all__')

  const listInvoicesQuery = trpc.accounting.listStripeInvoicesByDateRange.useQuery(
    { dateFrom, dateTo },
    { enabled: !!dateFrom && !!dateTo }
  )

  const allInvoices = listInvoicesQuery.data ?? []

  const projectOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string }[] = []
    for (const d of allInvoices) {
      if (!seen.has(d.projectSlug)) {
        seen.add(d.projectSlug)
        opts.push({ value: d.projectSlug, label: d.projectName })
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label))
  }, [allInvoices])

  const filteredInvoices = useMemo(() => {
    return allInvoices.filter((d) => {
      if (selectedFund !== '__all__' && d.fundSlug !== selectedFund) return false
      if (selectedProject !== '__all__' && d.projectSlug !== selectedProject) return false
      return true
    })
  }, [allInvoices, selectedFund, selectedProject])

  const summary = useMemo(() => {
    const byFund = new Map<string, { fundTitle: string; grossSum: number; feeSum: number; netSum: number }>()
    for (const d of filteredInvoices) {
      const fundTitle =
        funds[d.fundSlug as keyof typeof funds]?.title?.replace(' Fund', '') ?? d.fundSlug
      const existing = byFund.get(d.fundSlug)
      if (existing) {
        existing.grossSum += d.grossFiatAmount
        existing.feeSum += d.fee
        existing.netSum += d.netFiatAmount
      } else {
        byFund.set(d.fundSlug, {
          fundTitle,
          grossSum: d.grossFiatAmount,
          feeSum: d.fee,
          netSum: d.netFiatAmount,
        })
      }
    }
    return Array.from(byFund.entries()).map(([fundSlug, data]) => ({
      fundSlug,
      ...data,
    }))
  }, [filteredInvoices])

  const summarySort = useSortableColumn('fund')
  const sortedSummary = useMemo(
    () =>
      sortRows(
        summary,
        summarySort.columnKey,
        summarySort.direction,
        {
          fund: (r) => r.fundSlug,
          amount: (r) => r.grossSum,
          fee: (r) => r.feeSum,
          net: (r) => r.netSum,
        }
      ),
    [summary, summarySort.columnKey, summarySort.direction]
  )

  const invoicesSort = useSortableColumn('time')
  const sortedFilteredInvoices = useMemo(
    () =>
      sortRows(
        filteredInvoices,
        invoicesSort.columnKey,
        invoicesSort.direction,
        {
          time: (r) => r.createdAt,
          fund: (r) => r.fundSlug,
          project: (r) => r.projectName,
          payment: (r) => r.paymentId,
          amount: (r) => r.grossFiatAmount,
          fee: (r) => r.fee,
          net: (r) => r.netFiatAmount,
          recurring: (r) => (r.isRecurring ? 1 : 0),
        }
      ),
    [filteredInvoices, invoicesSort.columnKey, invoicesSort.direction]
  )

  return (
    <>
      <Head>
        <title>Stripe Invoices</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Stripe Invoices</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end">
          <Select value={selectedFund} onValueChange={(v) => setSelectedFund(v)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All funds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All funds</SelectItem>
              {Object.entries(funds).map(([slug, fund]) => (
                <SelectItem key={slug} value={slug}>
                  {fund.title.replace(' Fund', '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedProject} onValueChange={(v) => setSelectedProject(v)}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All projects</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label.length > 30 ? `${p.label.slice(0, 30)}…` : p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                      columnKey="fund"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Fund
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="amount"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Amount
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="fee"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Fee
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="net"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Net
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSummary.map((row) => (
                    <TableRow key={row.fundSlug}>
                      <TableCell>
                        <FundBadge fundSlug={row.fundSlug} />
                      </TableCell>
                      <TableCell>{usdFormat.format(row.grossSum)}</TableCell>
                      <TableCell>{usdFormat.format(row.feeSum)}</TableCell>
                      <TableCell>{usdFormat.format(row.netSum)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <Button
              size="sm"
              onClick={() => exportToCsv(filteredInvoices)}
              disabled={filteredInvoices.length === 0}
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
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Time
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="fund"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Fund
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="project"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Project
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="payment"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Payment ID
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="amount"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Amount
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="fee"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Fee
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="net"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Net
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="recurring"
                      currentKey={invoicesSort.columnKey}
                      direction={invoicesSort.direction}
                      onToggle={invoicesSort.toggle}
                    >
                      Recurring
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {listInvoicesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No invoices for this date range
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedFilteredInvoices.map((record) => {
                    return (
                      <TableRow key={record.id}>
                        <TableCell>{dayjs(record.createdAt).format('lll')}</TableCell>
                        <TableCell>
                          <FundBadge fundSlug={record.fundSlug} />
                        </TableCell>
                        <TableCell title={record.projectName}>
                          {record.projectName.length > 20
                            ? `${record.projectName.slice(0, 20)}…`
                            : record.projectName}
                        </TableCell>
                        <TableCell>
                          <CopyableText text={record.paymentId} truncate />
                        </TableCell>
                        <TableCell>{usdFormat.format(record.grossFiatAmount)}</TableCell>
                        <TableCell>{usdFormat.format(record.fee)}</TableCell>
                        <TableCell>{usdFormat.format(record.netFiatAmount)}</TableCell>
                        <TableCell>{record.isRecurring ? 'Yes' : 'No'}</TableCell>
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
