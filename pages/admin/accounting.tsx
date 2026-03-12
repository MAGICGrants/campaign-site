import { useState, useMemo } from 'react'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import utc from 'dayjs/plugin/utc'
import Head from 'next/head'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
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
import { Check, ChevronDown, ChevronsUpDownIcon, Copy, Download, TableIcon } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { cn } from '../../utils/cn'
import { trpc } from '../../utils/trpc'
import { DonationSource } from '@prisma/client'
import { funds } from '../../utils/funds'

dayjs.extend(localizedFormat)
dayjs.extend(utc)

type MatchedDeposit = {
  txid: string
  time: string
  cryptoCode: string
  depositAmount: number
  krakenFee: number
  networkFee: number
  matchedCrypto: number
}

type MatchedOrder = {
  orderId: string
  closedAt: string
  pair: string
  volExec: number
  cost: number
  fee: number
  netProceeds: number
  matchedCrypto: number
  matchedUsd: number
}

const SOURCE_OPTIONS: { value: DonationSource; label: string }[] = [
  { value: 'btcpayserver', label: 'BTCPay Server' },
  { value: 'coinbase', label: 'Coinbase' },
  { value: 'stripe', label: 'Stripe' },
]

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

type AccountingRecord = {
  id: string
  paymentReceivedAt: Date
  source: string
  fundSlug: string
  projectSlug: string
  projectName: string
  invoiceId: string
  cryptoAmount: string
  cryptoCode: string
  rate: string
  fiatAmount: number
  fee: number | null
  krakenDeposits: MatchedDeposit[] | null
  krakenOrders: MatchedOrder[] | null
  totalRealizedUsd: number
}

function exportToCsv(records: (Omit<AccountingRecord, 'krakenDeposits' | 'krakenOrders'> & { krakenDeposits?: unknown; krakenOrders?: unknown })[]) {
  const headers = [
    'time',
    'source',
    'fund',
    'project',
    'invoiceId',
    'amount',
    'asset',
    'amountUsd',
    'fee',
    'depositIds',
    'orderIds',
    'realizedUsd',
  ]
  const rows = records.map((record) => {
    const deposits = (record.krakenDeposits as MatchedDeposit[] | null) ?? []
    const orders = (record.krakenOrders as MatchedOrder[] | null) ?? []
    const amountUsd =
      record.source === 'stripe' ? record.fiatAmount : Number(record.cryptoAmount) * Number(record.rate)
    const feeStr =
      record.source === 'stripe' && record.fee != null ? record.fee.toFixed(2) : '-'
    return [
      dayjs.utc(record.paymentReceivedAt).format('YYYY-MM-DD HH:mm:ss') + ' GMT',
      record.source,
      funds[record.fundSlug as keyof typeof funds].title.replace(' Fund', ''),
      record.projectName,
      record.invoiceId,
      record.cryptoAmount,
      record.cryptoCode,
      amountUsd.toFixed(2),
      feeStr,
      record.source === 'stripe' ? '-' : deposits.map((d) => d.txid).join(';'),
      record.source === 'stripe' ? '-' : orders.map((o) => o.orderId).join(';'),
      record.totalRealizedUsd.toFixed(2),
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
  a.download = `donation-accounting-${dayjs().format('YYYY-MM-DD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSummaryToCsv(
  summaryByFund: { fundTitle: string; invoiceSum: number; depositSum: number; difference: number }[]
) {
  const headers = ['fund', 'invoiceSum', 'depositSum', 'difference']
  const rows = summaryByFund.map((row) => [
    row.fundTitle,
    row.invoiceSum.toFixed(2),
    row.depositSum.toFixed(2),
    row.difference.toFixed(2),
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `donation-summary-${dayjs().format('YYYY-MM-DD')}.csv`
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

function DepositsDialog({
  open,
  onOpenChange,
  deposits,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deposits: MatchedDeposit[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Kraken Deposits</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-white [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <Table className="w-full min-w-max">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Time</TableHead>
                <TableHead>TXID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Network Fee</TableHead>
                <TableHead>Matched Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((d, i) => (
                <TableRow key={`${d.txid}-${i}`}>
                  <TableCell>{dayjs(d.time).format('lll')}</TableCell>
                  <TableCell>
                    <CopyableText text={d.txid} truncate />
                  </TableCell>
                  <TableCell>{`${d.depositAmount.toFixed(4)} ${d.cryptoCode}`}</TableCell>
                  <TableCell>
                    {d.networkFee.toFixed(8)} {d.cryptoCode}
                  </TableCell>
                  <TableCell>{`${d.matchedCrypto.toFixed(4)} ${d.cryptoCode}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OrdersDialog({
  open,
  onOpenChange,
  orders,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orders: MatchedOrder[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Kraken Orders</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-white [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <Table className="w-full min-w-max">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Close Time</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Pair</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Matched Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const cryptoCode = o.pair.replace(/Z?USD$/i, '')
                return (
                  <TableRow key={o.orderId}>
                    <TableCell>{dayjs(o.closedAt).format('lll')}</TableCell>
                    <TableCell>
                      <CopyableText text={o.orderId} truncate />
                    </TableCell>
                    <TableCell>{o.pair}</TableCell>
                    <TableCell>{`${o.volExec.toFixed(4)} ${cryptoCode}`}</TableCell>
                    <TableCell>{o.fee.toFixed(2)} USD</TableCell>
                    <TableCell>{`${o.matchedCrypto.toFixed(4)} ${cryptoCode}`}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function AccountingPage() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    formatMonthOption(now.getFullYear(), now.getMonth() + 1)
  )
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [selectedFund, setSelectedFund] = useState<string>('__all__')
  const [selectedSources, setSelectedSources] = useState<DonationSource[]>([
    'btcpayserver',
    'coinbase',
  ])
  const [depositsDialog, setDepositsDialog] = useState<{
    open: boolean
    deposits: MatchedDeposit[]
  }>({ open: false, deposits: [] })
  const [ordersDialog, setOrdersDialog] = useState<{
    open: boolean
    orders: MatchedOrder[]
  }>({ open: false, orders: [] })

  const [year, month] = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    return [y, m] as [number, number]
  }, [selectedMonth])

  const availableMonthsQuery = trpc.accounting.listAvailableMonths.useQuery()
  const availableProjectsQuery = trpc.accounting.listAvailableProjects.useQuery()
  const listByMonthQuery = trpc.accounting.listByMonth.useQuery(
    {
      year,
      month,
      projectSlug: selectedProject === '__all__' ? undefined : selectedProject,
      fundSlug: selectedFund === '__all__' ? undefined : selectedFund,
      sources: selectedSources.length > 0 ? selectedSources : undefined,
    },
    { enabled: !!year && !!month }
  )

  const monthOptions = useMemo(() => {
    const months = availableMonthsQuery.data ?? []
    if (months.length === 0) {
      const opts: { value: string; label: string }[] = []
      const today = new Date()
      for (let i = 0; i < 12; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        opts.push({
          value: formatMonthOption(d.getFullYear(), d.getMonth() + 1),
          label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
        })
      }
      return opts
    }
    return months
      .map(({ year: y, month: m }) => ({
        value: formatMonthOption(y, m),
        label: `${MONTH_NAMES[m - 1]} ${y}`,
      }))
      .sort((a, b) => b.value.localeCompare(a.value))
  }, [availableMonthsQuery.data])

  const records = listByMonthQuery.data ?? []

  const summaryByFund = useMemo(() => {
    const byFund = new Map<string, { fundTitle: string; invoiceSum: number; depositSum: number }>()
    for (const record of records) {
      const fundSlug = record.fundSlug
      const fundTitle = funds[fundSlug].title.replace(' Fund', '')
      const amountUsd =
        record.source === 'stripe' ? record.fiatAmount : Number(record.cryptoAmount) * Number(record.rate)
      const existing = byFund.get(fundSlug)
      if (existing) {
        existing.invoiceSum += amountUsd
        existing.depositSum += record.totalRealizedUsd
      } else {
        byFund.set(fundSlug, {
          fundTitle,
          invoiceSum: amountUsd,
          depositSum: record.totalRealizedUsd,
        })
      }
    }
    return Array.from(byFund.entries()).map(([slug, data]) => ({
      fundSlug: slug,
      ...data,
      difference: data.depositSum - data.invoiceSum,
    }))
  }, [records])

  return (
    <>
      <Head>
        <title>Donation Accounting</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Donation Accounting</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end">
          <Popover>
            <Select>
              <PopoverTrigger className="w-full sm:w-[180px]" asChild>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      selectedSources.length === SOURCE_OPTIONS.length
                        ? 'All sources'
                        : selectedSources.length === 0
                          ? 'Select sources'
                          : `${selectedSources.length} source${selectedSources.length !== 1 ? 's' : ''}`
                    }
                  />
                </SelectTrigger>
              </PopoverTrigger>
            </Select>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
              <div className="max-h-72 overflow-auto">
                {SOURCE_OPTIONS.map((opt) => {
                  const isSelected = selectedSources.includes(opt.value)
                  return (
                    <div
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        'relative flex w-full cursor-pointer select-none items-center py-1.5 pl-2 pr-8 text-sm outline-none rounded-sm',
                        'focus:text-primary hover:bg-primary/10 hover:text-primary'
                      )}
                      onClick={() => {
                        setSelectedSources((prev) =>
                          isSelected ? prev.filter((s) => s !== opt.value) : [...prev, opt.value]
                        )
                      }}
                    >
                      {opt.label}
                      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                        {isSelected ? <Check className="h-4 w-4" /> : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
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
              {availableProjectsQuery.data?.map((p) => (
                <SelectItem key={p.projectSlug} value={p.projectSlug}>
                  {p.projectName.length > 30 ? `${p.projectName.slice(0, 30)}…` : p.projectName}
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

        {records.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Summary</h2>
              <Button size="sm" onClick={() => exportSummaryToCsv(summaryByFund)}>
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
            </div>
            <div className="w-full overflow-x-auto rounded-md border bg-white shadow-sm">
              <Table className="w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-foreground">Fund</TableHead>
                    <TableHead className="text-foreground">Invoice Sum</TableHead>
                    <TableHead className="text-foreground">Deposit Sum</TableHead>
                    <TableHead className="text-foreground">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryByFund.map((row) => (
                    <TableRow key={row.fundSlug}>
                      <TableCell>{row.fundTitle}</TableCell>
                      <TableCell>{usdFormat.format(row.invoiceSum)}</TableCell>
                      <TableCell>{usdFormat.format(row.depositSum)}</TableCell>
                      <TableCell>{usdFormat.format(row.difference)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Donations</h2>
            <Button size="sm" onClick={() => exportToCsv(records)} disabled={records.length === 0}>
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
          <div className="w-full min-w-0 overflow-x-auto overflow-hidden rounded-md border bg-white shadow-sm">
            <Table className="min-w-[800px] w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Time</TableHead>
                  <TableHead className="text-foreground">Source</TableHead>
                  <TableHead className="text-foreground">Fund</TableHead>
                  <TableHead className="text-foreground">Project</TableHead>
                  <TableHead className="text-foreground">Invoice ID</TableHead>
                  <TableHead className="text-foreground">Amount</TableHead>
                  <TableHead className="text-foreground">Amount USD</TableHead>
                  <TableHead className="text-foreground">Fee</TableHead>
                  <TableHead className="text-foreground">Deposits</TableHead>
                  <TableHead className="text-foreground">Orders</TableHead>
                  <TableHead className="text-foreground">Realized</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listByMonthQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No records for this month
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => {
                    const deposits = (record.krakenDeposits as MatchedDeposit[] | null) ?? []
                    const orders = (record.krakenOrders as MatchedOrder[] | null) ?? []
                    const amountUsd =
                      record.source === 'stripe'
                        ? record.fiatAmount
                        : Number(record.cryptoAmount) * Number(record.rate)
                    const cryptoFormatted =
                      record.source === 'stripe'
                        ? '-'
                        : `${Number(record.cryptoAmount).toFixed(3)} ${record.cryptoCode}`
                    const isStripe = record.source === 'stripe'
                    return (
                      <TableRow key={record.id}>
                        <TableCell>{dayjs(record.paymentReceivedAt).format('lll')}</TableCell>
                        <TableCell>
                          {SOURCE_OPTIONS.find((o) => o.value === record.source)?.label ??
                            record.source}
                        </TableCell>
                        <TableCell>
                          {funds[record.fundSlug as keyof typeof funds].title.replace(' Fund', '')}
                        </TableCell>
                        <TableCell title={record.projectName}>
                          {record.projectName.length > 20
                            ? `${record.projectName.slice(0, 20)}…`
                            : record.projectName}
                        </TableCell>
                        <TableCell>
                          <CopyableText text={record.invoiceId} truncate />
                        </TableCell>
                        <TableCell>{cryptoFormatted}</TableCell>
                        <TableCell>{usdFormat.format(amountUsd)}</TableCell>
                        <TableCell>
                          {isStripe && record.fee != null
                            ? usdFormat.format(record.fee)
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {isStripe ? (
                            '-'
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>
                                {deposits.length} deposit{deposits.length !== 1 ? 's' : ''}
                              </span>
                              {deposits.length > 0 && (
                                <Button
                                  size="icon"
                                  variant="light"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => setDepositsDialog({ open: true, deposits })}
                                >
                                  <TableIcon size={14} />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {isStripe ? (
                            '-'
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>
                                {orders.length} order{orders.length !== 1 ? 's' : ''}
                              </span>
                              {orders.length > 0 && (
                                <Button
                                  size="icon"
                                  variant="light"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => setOrdersDialog({ open: true, orders })}
                                >
                                  <TableIcon size={14} />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{usdFormat.format(record.totalRealizedUsd)}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <DepositsDialog
        open={depositsDialog.open}
        onOpenChange={(open) => setDepositsDialog((p) => ({ ...p, open }))}
        deposits={depositsDialog.deposits}
      />
      <OrdersDialog
        open={ordersDialog.open}
        onOpenChange={(open) => setOrdersDialog((p) => ({ ...p, open }))}
        orders={ordersDialog.orders}
      />
    </>
  )
}
