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

type KrakenDepositItem = {
  refid: string
  asset: string
  cryptoCode: string
  txid: string
  amount: number
  fee: number
  time: Date
  status: string
}

function formatAmount(amount: number, cryptoCode: string): string {
  const decimals = cryptoCode === 'USDC' ? 2 : 8
  return `${amount.toFixed(decimals)} ${cryptoCode}`
}

function exportToCsv(records: KrakenDepositItem[]) {
  const headers = ['time', 'amount', 'asset', 'depositId', 'txHash', 'status']
  const rows = records.map((record) => [
    dayjs(record.time).format('YYYY-MM-DD HH:mm:ss') + ' UTC',
    record.amount,
    record.cryptoCode,
    record.refid,
    record.txid,
    record.status,
  ])
  const csv =
    headers.map(escapeCsvValue).join(',') +
    '\n' +
    rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kraken-deposits-${dayjs().format('YYYY-MM-DD')}.csv`
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

export default function KrakenDepositsPage() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    formatMonthOption(now.getFullYear(), now.getMonth() + 1)
  )
  const [selectedCurrency, setSelectedCurrency] = useState<string>('__all__')

  const [year, month] = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    return [y, m] as [number, number]
  }, [selectedMonth])

  const listDepositsQuery = trpc.accounting.listKrakenDepositsByMonth.useQuery(
    { year, month },
    { enabled: !!year && !!month }
  )

  const allDeposits = listDepositsQuery.data ?? []

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

  const currencyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const d of allDeposits) {
      seen.add(d.cryptoCode)
    }
    return Array.from(seen).sort()
  }, [allDeposits])

  const filteredDeposits = useMemo(() => {
    if (selectedCurrency === '__all__') return allDeposits
    return allDeposits.filter((d) => d.cryptoCode === selectedCurrency)
  }, [allDeposits, selectedCurrency])

  const summary = useMemo(() => {
    const byCurrency = new Map<string, number>()
    for (const d of filteredDeposits) {
      const existing = byCurrency.get(d.cryptoCode) ?? 0
      byCurrency.set(d.cryptoCode, existing + d.amount)
    }
    return Array.from(byCurrency.entries())
      .map(([cryptoCode, sum]) => ({ cryptoCode, sum }))
      .sort((a, b) => a.cryptoCode.localeCompare(b.cryptoCode))
  }, [filteredDeposits])

  return (
    <>
      <Head>
        <title>Kraken Deposits</title>
      </Head>

      <div className="w-full mx-auto flex flex-col space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Kraken Deposits</h1>

        <div className="ml-auto flex flex-row gap-2 flex-wrap justify-end">
          <Select value={selectedCurrency} onValueChange={(v) => setSelectedCurrency(v)}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="All currencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All currencies</SelectItem>
              {currencyOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
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

        {summary.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Summary</h2>
            </div>
            <div className="w-full overflow-x-auto rounded-md border bg-white shadow-sm">
              <Table className="w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-foreground">Currency</TableHead>
                    <TableHead className="text-foreground">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((row) => (
                    <TableRow key={row.cryptoCode}>
                      <TableCell>{row.cryptoCode}</TableCell>
                      <TableCell>{formatAmount(row.sum, row.cryptoCode)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Deposits</h2>
            <Button
              size="sm"
              onClick={() => exportToCsv(filteredDeposits)}
              disabled={filteredDeposits.length === 0}
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
          <div className="w-full min-w-0 overflow-x-auto overflow-hidden rounded-md border bg-white shadow-sm">
            <Table className="min-w-[700px] w-full [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Time</TableHead>
                  <TableHead className="text-foreground">Amount</TableHead>
                  <TableHead className="text-foreground">Deposit ID</TableHead>
                  <TableHead className="text-foreground">Transaction Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listDepositsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredDeposits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No deposits for this month
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDeposits.map((record) => (
                    <TableRow key={record.refid}>
                      <TableCell>{dayjs(record.time).format('lll')}</TableCell>
                      <TableCell>{formatAmount(record.amount, record.cryptoCode)}</TableCell>
                      <TableCell>
                        <CopyableText text={record.refid} truncate />
                      </TableCell>
                      <TableCell>
                        <CopyableText text={record.txid} truncate />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  )
}
