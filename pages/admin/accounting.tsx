import { useState, useMemo, useRef, useEffect } from 'react'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import utc from 'dayjs/plugin/utc'
import Head from 'next/head'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
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
import { Check, Copy, Download, Plus, Settings2, TableIcon, Trash2 } from 'lucide-react'
  import { useSession } from 'next-auth/react'
  import { DonationSource } from '@prisma/client'

import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip'
import { FundBadge } from '../../components/admin/FundBadge'
import { AccountingDonationCharts } from '../../components/admin/AccountingDonationCharts'
import { AdminDateRangePicker } from '../../components/admin/AdminDateRangePicker'
import { SortableTableHead, sortRows, useSortableColumn } from '../../components/admin/sortable-table'
import { useAccountingPageQuery } from '../../hooks/useAccountingPageQuery'
import { cn } from '../../utils/cn'

import { trpc } from '../../utils/trpc'
import { funds, fundSlugs, type FundStackKey } from '../../utils/funds'

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

type AccountingRecord = {
  id: string
  paymentReceivedAt: Date
  source: string
  fundSlug: string | null
  projectSlug: string | null
  projectName: string | null
  invoiceId: string | null
  cryptoAmount: string
  cryptoCode: string
  rate: string
  fiatAmount: number
  fee: number | null
  cryptoProcessorFee?: string | null
  krakenDeposits: MatchedDeposit[] | null
  krakenOrders: MatchedOrder[] | null
  totalRealizedUsd: number
}

/** Fields needed for net amount / net USD (avoids coupling to full row + kraken JSON types). */
type NetAmountRow = Pick<
  AccountingRecord,
  'source' | 'cryptoAmount' | 'cryptoCode' | 'rate' | 'fiatAmount' | 'fee' | 'cryptoProcessorFee'
>

function formatNetAmountDisplay(record: NetAmountRow): string {
  if (record.source === 'stripe') return '—'
  if (record.source === 'coinbase') {
    const gross = Number(record.cryptoAmount)
    const fee = Number(record.cryptoProcessorFee ?? 0)
    const net = Math.max(0, gross - fee)
    return `${net.toFixed(3)} ${record.cryptoCode}`
  }
  return `${Number(record.cryptoAmount).toFixed(3)} ${record.cryptoCode}`
}

function formatNetUsdDisplay(record: NetAmountRow): string {
  if (record.source === 'stripe') {
    const net = record.fee != null ? record.fiatAmount - record.fee : record.fiatAmount
    return usdFormat.format(net)
  }
  if (record.source === 'coinbase') {
    return usdFormat.format(record.fiatAmount - (record.fee ?? 0))
  }
  return usdFormat.format(Number(record.cryptoAmount) * Number(record.rate))
}

function netUsdNumericCsv(record: NetAmountRow): string {
  if (record.source === 'stripe') {
    const n = record.fee != null ? record.fiatAmount - record.fee : record.fiatAmount
    return n.toFixed(2)
  }
  if (record.source === 'coinbase') {
    return (record.fiatAmount - (record.fee ?? 0)).toFixed(2)
  }
  return (Number(record.cryptoAmount) * Number(record.rate)).toFixed(2)
}

/** CSV: net in crypto, or '-' when not applicable (e.g. Stripe). */
function netAmountCryptoCsv(record: NetAmountRow): string {
  if (record.source === 'stripe') return '-'
  return formatNetAmountDisplay(record).replace(/—/g, '-')
}

function exportToCsv(
  records: (Omit<AccountingRecord, 'krakenDeposits' | 'krakenOrders'> & {
    krakenDeposits?: unknown
    krakenOrders?: unknown
  })[]
) {
  const headers = [
    'time',
    'source',
    'fund',
    'project',
    'invoiceId',
    'amount',
    'asset',
    'amountUsd',
    'netAmount',
    'netAmountCrypto',
    'depositIds',
    'orderIds',
    'realizedUsd',
  ]
  const rows = records.map((record) => {
    const deposits = (record.krakenDeposits as MatchedDeposit[] | null) ?? []
    const orders = (record.krakenOrders as MatchedOrder[] | null) ?? []
    const amountUsd =
      record.source === 'stripe'
        ? record.fiatAmount
        : Number(record.cryptoAmount) * Number(record.rate)
    return [
      dayjs.utc(record.paymentReceivedAt).format('YYYY-MM-DD HH:mm:ss') + ' GMT',
      record.source,
      record.fundSlug && record.fundSlug in funds
        ? funds[record.fundSlug as keyof typeof funds].title.replace(' Fund', '')
        : '—',
      record.projectName ?? '—',
      record.invoiceId ?? '—',
      record.cryptoAmount,
      record.cryptoCode,
      amountUsd.toFixed(2),
      netUsdNumericCsv(record),
      netAmountCryptoCsv(record),
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
  const [copied, setCopied] = useState(false)
  const hideCopiedRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hideCopiedRef.current) clearTimeout(hideCopiedRef.current)
    }
  }, [])

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    if (hideCopiedRef.current) clearTimeout(hideCopiedRef.current)
    hideCopiedRef.current = setTimeout(() => setCopied(false), 2000)
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
      <Tooltip
        open={copied}
        onOpenChange={(open) => {
          if (!open) setCopied(false)
        }}
      >
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side="top">Copied!</TooltipContent>
      </Tooltip>
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
  const sort = useSortableColumn('time')
  const sortedDeposits = useMemo(
    () =>
      sortRows(
        deposits,
        sort.columnKey,
        sort.direction,
        {
          time: (d) => new Date(d.time),
          txid: (d) => d.txid,
          amount: (d) => d.depositAmount,
          networkFee: (d) => d.networkFee,
          matched: (d) => d.matchedCrypto,
        }
      ),
    [deposits, sort.columnKey, sort.direction]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Kraken Deposits</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-white [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <Table className="w-full min-w-max">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableTableHead
                  columnKey="time"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Time
                </SortableTableHead>
                <SortableTableHead
                  columnKey="txid"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  TXID
                </SortableTableHead>
                <SortableTableHead
                  columnKey="amount"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Amount
                </SortableTableHead>
                <SortableTableHead
                  columnKey="networkFee"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Network Fee
                </SortableTableHead>
                <SortableTableHead
                  columnKey="matched"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Matched Amount
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedDeposits.map((d, i) => (
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
  const sort = useSortableColumn('time')
  const sortedOrders = useMemo(
    () =>
      sortRows(
        orders,
        sort.columnKey,
        sort.direction,
        {
          time: (o) => new Date(o.closedAt),
          orderId: (o) => o.orderId,
          pair: (o) => o.pair,
          amount: (o) => o.volExec,
          fee: (o) => o.fee,
          matched: (o) => o.matchedCrypto,
        }
      ),
    [orders, sort.columnKey, sort.direction]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Kraken Orders</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-white [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <Table className="w-full min-w-max">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableTableHead
                  columnKey="time"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Close Time
                </SortableTableHead>
                <SortableTableHead
                  columnKey="orderId"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Order ID
                </SortableTableHead>
                <SortableTableHead
                  columnKey="pair"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Pair
                </SortableTableHead>
                <SortableTableHead
                  columnKey="amount"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Amount
                </SortableTableHead>
                <SortableTableHead
                  columnKey="fee"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Fee
                </SortableTableHead>
                <SortableTableHead
                  columnKey="matched"
                  currentKey={sort.columnKey}
                  direction={sort.direction}
                  onToggle={sort.toggle}
                >
                  Matched Amount
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOrders.map((o) => {
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

function IgnoredItemsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpc.useUtils()
  const ignoresQuery = trpc.accounting.listAccountingIgnores.useQuery(undefined, {
    enabled: open,
  })
  const addIgnore = trpc.accounting.addAccountingIgnore.useMutation({
    onSuccess: () => {
      utils.accounting.listAccountingIgnores.invalidate()
      utils.accounting.listByDateRange.invalidate()
      utils.accounting.listAvailableMonths.invalidate()
      utils.accounting.listAvailableProjects.invalidate()
    },
  })
  const removeIgnore = trpc.accounting.removeAccountingIgnore.useMutation({
    onSuccess: () => {
      utils.accounting.listAccountingIgnores.invalidate()
      utils.accounting.listByDateRange.invalidate()
      utils.accounting.listAvailableMonths.invalidate()
      utils.accounting.listAvailableProjects.invalidate()
    },
  })

  const [newDepositTxid, setNewDepositTxid] = useState('')
  const [newOrderId, setNewOrderId] = useState('')

  const deposits = ignoresQuery.data?.deposits ?? []
  const orders = ignoresQuery.data?.orders ?? []

  function handleAddDeposit(e: React.FormEvent) {
    e.preventDefault()
    const txid = newDepositTxid.trim()
    if (!txid) return
    addIgnore.mutate({ type: 'deposit', value: txid })
    setNewDepositTxid('')
  }

  function handleAddOrder(e: React.FormEvent) {
    e.preventDefault()
    const orderId = newOrderId.trim()
    if (!orderId) return
    addIgnore.mutate({ type: 'order', value: orderId })
    setNewOrderId('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Ignored Deposits & Orders</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          These deposit TXIDs and order IDs are excluded from accounting matching. Adding or
          removing triggers a regeneration job.
        </p>

        <div className="grid gap-6 sm:grid-cols-2 min-w-0">
          <div className="space-y-3 min-w-0">
            <h4 className="font-medium">Ignored deposit TXIDs</h4>
            <form onSubmit={handleAddDeposit} className="flex w-full min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  value={newDepositTxid}
                  onChange={(e) => setNewDepositTxid(e.target.value)}
                  className="h-9 w-full font-mono text-xs"
                />
              </div>
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!newDepositTxid.trim() || addIgnore.isPending}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <div className="rounded-md border bg-muted/30 max-h-40 overflow-auto">
              {deposits.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="divide-y divide-border">
                  {deposits.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-mono min-w-0"
                    >
                      <span className="min-w-0 flex-1 truncate" title={item.value}>
                        {item.value}
                      </span>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeIgnore.mutate({ id: item.id })}
                        disabled={removeIgnore.isPending}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <h4 className="font-medium">Ignored order IDs</h4>
            <form onSubmit={handleAddOrder} className="flex w-full min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  value={newOrderId}
                  onChange={(e) => setNewOrderId(e.target.value)}
                  className="h-9 w-full font-mono text-xs"
                />
              </div>
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!newOrderId.trim() || addIgnore.isPending}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <div className="rounded-md border bg-muted/30 max-h-40 overflow-auto">
              {orders.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">None</p>
              ) : (
                <ul className="divide-y divide-border">
                  {orders.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-mono min-w-0"
                    >
                      <span className="min-w-0 flex-1 truncate" title={item.value}>
                        {item.value}
                      </span>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeIgnore.mutate({ id: item.id })}
                        disabled={removeIgnore.isPending}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function AccountingPage() {
  const { data: session } = useSession()
  const accountingFunds = session?.user?.accountingFunds ?? []

  const allowedFundKeys = useMemo(() => {
    const out = new Set<string>(['__all__'])
    for (const k of accountingFunds) {
      if (k === 'unknown') out.add('__unknown__')
      else out.add(k)
    }
    return out
  }, [accountingFunds])

  const { state, patchQuery, summarySort, donationsSort } = useAccountingPageQuery(allowedFundKeys)
  const { dateFrom, dateTo, fund: selectedFund, project: selectedProject, sources: selectedSources } =
    state
  const [depositsDialog, setDepositsDialog] = useState<{
    open: boolean
    deposits: MatchedDeposit[]
  }>({ open: false, deposits: [] })
  const [ordersDialog, setOrdersDialog] = useState<{
    open: boolean
    orders: MatchedOrder[]
  }>({ open: false, orders: [] })
  const [ignoredItemsDialogOpen, setIgnoredItemsDialogOpen] = useState(false)

  const availableProjectsQuery = trpc.accounting.listAvailableProjects.useQuery()
  const listByDateRangeQuery = trpc.accounting.listByDateRange.useQuery(
    {
      dateFrom,
      dateTo,
      projectSlug: selectedProject === '__all__' ? undefined : selectedProject,
      fundSlug: selectedFund === '__all__' ? undefined : selectedFund,
      sources: selectedSources.length > 0 ? selectedSources : undefined,
    },
    { enabled: !!dateFrom && !!dateTo }
  )

  const records = listByDateRangeQuery.data ?? []

  const showCoinbaseNetColumns = useMemo(
    () => records.some((r) => r.source === 'coinbase'),
    [records]
  )

  const donationTableColSpan = showCoinbaseNetColumns ? 12 : 10

  const summaryByFund = useMemo(() => {
    const byFund = new Map<string, { fundTitle: string; invoiceSum: number; depositSum: number }>()
    for (const record of records) {
      const fundSlug = record.fundSlug ?? '__unknown__'
      const fundTitle =
        fundSlug !== '__unknown__' && fundSlug in funds
          ? funds[fundSlug as keyof typeof funds].title.replace(' Fund', '')
          : 'Unknown'
      const amountUsd =
        record.source === 'stripe'
          ? record.fiatAmount
          : Number(record.cryptoAmount) * Number(record.rate)
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

  const sortedSummaryByFund = useMemo(
    () =>
      sortRows(
        summaryByFund,
        summarySort.columnKey,
        summarySort.direction,
        {
          fund: (r) => r.fundSlug,
          invoiceSum: (r) => r.invoiceSum,
          depositSum: (r) => r.depositSum,
          difference: (r) => r.difference,
        }
      ),
    [summaryByFund, summarySort.columnKey, summarySort.direction]
  )

  const sortedRecords = useMemo(() => {
    type Row = (typeof records)[number]
    const accessors: Record<string, (r: Row) => unknown> = {
      time: (r) => r.paymentReceivedAt,
      source: (r) => r.source,
      fund: (r) => r.fundSlug ?? '',
      project: (r) => r.projectName ?? '',
      invoice: (r) => r.invoiceId ?? '',
      amount: (r) => (r.source === 'stripe' ? 0 : Number(r.cryptoAmount)),
      amountUsd: (r) =>
        r.source === 'stripe' ? r.fiatAmount : Number(r.cryptoAmount) * Number(r.rate),
      netAmount: (r) => {
        if (r.source === 'stripe') return 0
        if (r.source === 'coinbase') {
          const gross = Number(r.cryptoAmount)
          const fee = Number(r.cryptoProcessorFee ?? 0)
          return Math.max(0, gross - fee)
        }
        return Number(r.cryptoAmount)
      },
      netUsd: (r) => {
        if (r.source === 'stripe') {
          return r.fee != null ? r.fiatAmount - r.fee : r.fiatAmount
        }
        if (r.source === 'coinbase') {
          return r.fiatAmount - (r.fee ?? 0)
        }
        return Number(r.cryptoAmount) * Number(r.rate)
      },
      deposits: (r) => ((r.krakenDeposits as MatchedDeposit[] | null) ?? []).length,
      orders: (r) => ((r.krakenOrders as MatchedOrder[] | null) ?? []).length,
      realized: (r) => r.totalRealizedUsd,
    }
    return sortRows(records, donationsSort.columnKey, donationsSort.direction, accessors)
  }, [records, donationsSort.columnKey, donationsSort.direction])

  return (
    <TooltipProvider delayDuration={0}>
      <>
        <Head>
          <title>Donation Accounting</title>
        </Head>

        <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Donation Accounting</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIgnoredItemsDialogOpen(true)}
            aria-label="Manage ignored deposits and orders"
          >
            <Settings2 className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Ignored items</span>
          </Button>
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
            <PopoverContent className="w-(--radix-popover-trigger-width) p-1" align="start">
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
                        const next = isSelected
                          ? selectedSources.filter((s) => s !== opt.value)
                          : [...selectedSources, opt.value]
                        patchQuery({ sources: next })
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
          <Select value={selectedFund} onValueChange={(v) => patchQuery({ fund: v })}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="All funds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All funds</SelectItem>
              {accountingFunds.includes('unknown') ? (
                <SelectItem value="__unknown__">Unknown</SelectItem>
              ) : null}
              {fundSlugs
                .filter((slug) => accountingFunds.includes(slug))
                .map((slug) => {
                  const fund = funds[slug]
                  return (
                    <SelectItem key={slug} value={slug}>
                      {fund.title.replace(' Fund', '')}
                    </SelectItem>
                  )
                })}
            </SelectContent>
          </Select>
          <Select value={selectedProject} onValueChange={(v) => patchQuery({ project: v })}>
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
          <AdminDateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(from, to) => patchQuery({ dateFrom: from, dateTo: to })}
          />
        </div>

        {listByDateRangeQuery.isSuccess && (
          <AccountingDonationCharts
            dateFrom={dateFrom}
            dateTo={dateTo}
            records={records}
            allowedStackKeys={accountingFunds as FundStackKey[]}
          />
        )}

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
                    <SortableTableHead
                      columnKey="fund"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Fund
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="invoiceSum"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Invoice Sum
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="depositSum"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Deposit Sum
                    </SortableTableHead>
                    <SortableTableHead
                      columnKey="difference"
                      currentKey={summarySort.columnKey}
                      direction={summarySort.direction}
                      onToggle={summarySort.toggle}
                    >
                      Difference
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSummaryByFund.map((row) => (
                    <TableRow key={row.fundSlug}>
                      <TableCell>
                        <FundBadge fundSlug={row.fundSlug} />
                      </TableCell>
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
                  <SortableTableHead
                    columnKey="time"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Time
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="source"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Source
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="fund"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Fund
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="project"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Project
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="invoice"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Invoice ID
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="amount"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Amount
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="amountUsd"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Amount USD
                  </SortableTableHead>
                  {showCoinbaseNetColumns && (
                    <>
                      <SortableTableHead
                        columnKey="netAmount"
                        currentKey={donationsSort.columnKey}
                        direction={donationsSort.direction}
                        onToggle={donationsSort.toggle}
                      >
                        Net amount
                      </SortableTableHead>
                      <SortableTableHead
                        columnKey="netUsd"
                        currentKey={donationsSort.columnKey}
                        direction={donationsSort.direction}
                        onToggle={donationsSort.toggle}
                      >
                        Net amount USD
                      </SortableTableHead>
                    </>
                  )}
                  <SortableTableHead
                    columnKey="deposits"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Deposits
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="orders"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Orders
                  </SortableTableHead>
                  <SortableTableHead
                    columnKey="realized"
                    currentKey={donationsSort.columnKey}
                    direction={donationsSort.direction}
                    onToggle={donationsSort.toggle}
                  >
                    Realized
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listByDateRangeQuery.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={donationTableColSpan}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={donationTableColSpan}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No records for this date range
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRecords.map((record) => {
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
                          {record.fundSlug ? <FundBadge fundSlug={record.fundSlug} /> : '—'}
                        </TableCell>
                        <TableCell title={record.projectName ?? undefined}>
                          {record.projectName
                            ? record.projectName.length > 20
                              ? `${record.projectName.slice(0, 20)}…`
                              : record.projectName
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <CopyableText text={record.invoiceId ?? '—'} truncate />
                        </TableCell>
                        <TableCell>{cryptoFormatted}</TableCell>
                        <TableCell>{usdFormat.format(amountUsd)}</TableCell>
                        {showCoinbaseNetColumns && (
                          <>
                            <TableCell>{formatNetAmountDisplay(record)}</TableCell>
                            <TableCell>{formatNetUsdDisplay(record)}</TableCell>
                          </>
                        )}
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
      <IgnoredItemsDialog open={ignoredItemsDialogOpen} onOpenChange={setIgnoredItemsDialogOpen} />
      </>
    </TooltipProvider>
  )
}
