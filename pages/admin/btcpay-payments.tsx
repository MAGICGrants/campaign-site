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
import { funds } from '../../utils/funds'
import type { BtcPayPaymentItem } from '../../server/types'

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

function exportToCsv(records: BtcPayPaymentItem[]) {
  const headers = [
    'time',
    'fund',
    'project',
    'invoiceId',
    'paymentId',
    'amount',
    'asset',
    'rate',
    'amountUsd',
    'isStaticGenerated',
  ]
  const rows = records.map((record) => [
    dayjs(record.receivedAt).format('YYYY-MM-DD HH:mm:ss') + ' UTC',
    funds[record.fundSlug as keyof typeof funds]?.title?.replace(' Fund', '') ?? record.fundSlug,
    record.projectName,
    record.invoiceId,
    record.paymentId,
    record.cryptoAmountRaw,
    record.cryptoCode,
    usdFormat.format(Number(record.rate)),
    record.fiatAmount.toFixed(2),
    record.isStaticGenerated ? 'Yes' : 'No',
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `btcpay-payments-${dayjs().format('YYYY-MM-DD')}.csv`
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

export default function BtcPayPaymentsPage() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    formatMonthOption(now.getFullYear(), now.getMonth() + 1)
  )
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [selectedFund, setSelectedFund] = useState<string>('__all__')

  const [year, month] = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    return [y, m] as [number, number]
  }, [selectedMonth])

  const listPaymentsQuery = trpc.accounting.listBtcPayPaymentsByMonth.useQuery(
    { year, month },
    { enabled: !!year && !!month }
  )

  const allPayments = listPaymentsQuery.data ?? []

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

  const projectOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string }[] = []
    for (const p of allPayments) {
      if (!seen.has(p.projectSlug)) {
        seen.add(p.projectSlug)
        opts.push({ value: p.projectSlug, label: p.projectName })
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label))
  }, [allPayments])

  const filteredPayments = useMemo(() => {
    return allPayments.filter((p) => {
      if (selectedFund !== '__all__' && p.fundSlug !== selectedFund) return false
      if (selectedProject !== '__all__' && p.projectSlug !== selectedProject) return false
      return true
    })
  }, [allPayments, selectedFund, selectedProject])

  const summaryByFund = useMemo(() => {
    const byFund = new Map<string, { fundTitle: string; sum: number }>()
    for (const p of filteredPayments) {
      const fundTitle =
        funds[p.fundSlug as keyof typeof funds]?.title?.replace(' Fund', '') ?? p.fundSlug
      const existing = byFund.get(p.fundSlug)
      if (existing) {
        existing.sum += p.fiatAmount
      } else {
        byFund.set(p.fundSlug, { fundTitle, sum: p.fiatAmount })
      }
    }
    return Array.from(byFund.entries()).map(([slug, data]) => ({
      fundSlug: slug,
      ...data,
    }))
  }, [filteredPayments])

  return (
    <>
      <Head>
        <title>BTCPay Server Payments</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">BTCPay Server Payments</h1>

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

        {filteredPayments.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Summary</h2>
            </div>
            <div className="w-full overflow-x-auto rounded-md border bg-white shadow-sm">
              <Table className="w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-foreground">Fund</TableHead>
                    <TableHead className="text-foreground">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryByFund.map((row) => (
                    <TableRow key={row.fundSlug}>
                      <TableCell>{row.fundTitle}</TableCell>
                      <TableCell>{usdFormat.format(row.sum)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Payments</h2>
            <Button
              size="sm"
              onClick={() => exportToCsv(filteredPayments)}
              disabled={filteredPayments.length === 0}
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
                  <TableHead className="text-foreground">Fund</TableHead>
                  <TableHead className="text-foreground">Project</TableHead>
                  <TableHead className="text-foreground">Invoice ID</TableHead>
                  <TableHead className="text-foreground">Amount</TableHead>
                  <TableHead className="text-foreground">Rate</TableHead>
                  <TableHead className="text-foreground">Static</TableHead>
                  <TableHead className="text-foreground">Amount USD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listPaymentsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No payments for this month
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments.map((record) => {
                    const cryptoFormatted = `${record.cryptoAmount} ${record.cryptoCode}`
                    const fundTitle =
                      funds[record.fundSlug as keyof typeof funds]?.title?.replace(' Fund', '') ??
                      record.fundSlug
                    return (
                      <TableRow key={record.paymentId}>
                        <TableCell>{dayjs(record.receivedAt).format('lll')}</TableCell>
                        <TableCell>{fundTitle}</TableCell>
                        <TableCell title={record.projectName}>
                          {record.projectName.length > 20
                            ? `${record.projectName.slice(0, 20)}…`
                            : record.projectName}
                        </TableCell>
                        <TableCell>
                          <CopyableText text={record.invoiceId} truncate />
                        </TableCell>
                        <TableCell>{cryptoFormatted}</TableCell>
                        <TableCell>{usdFormat.format(Number(record.rate))}</TableCell>
                        <TableCell>{record.isStaticGenerated ? 'Yes' : 'No'}</TableCell>
                        <TableCell>{usdFormat.format(record.fiatAmount)}</TableCell>
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
