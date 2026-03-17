import fs from 'fs'
import path from 'path'
import { FundSlug } from '@prisma/client'
import { log } from '../../utils/logging'

export type CoinbaseCsvPayment = {
  paymentId: string
  invoiceId: string
  receivedAt: Date
  cryptoCode: string
  cryptoAmount: number
  cryptoAmountRaw: string
  rate: string
  fiatAmount: number
  projectSlug: string | null
  projectName: string | null
  fundSlug: FundSlug | null
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      i++
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          current += '"'
          i += 2
        } else if (line[i] === '"') {
          i++
          break
        } else {
          current += line[i]
          i++
        }
      }
    } else if (line[i] === ',') {
      result.push(current.trim())
      current = ''
      i++
    } else {
      current += line[i]
      i++
    }
  }
  result.push(current.trim())
  return result
}

function extractMetadataFromCols(
  cols: string[],
  startIdx: number,
  endIdx: number
): Record<string, string> {
  const result: Record<string, string> = {}
  for (let j = startIdx; j < endIdx - 2; j += 3) {
    const key = cols[j]?.trim()
    const value = cols[j + 2]?.trim()
    if (key && value && !value.startsWith('0x') && !/^[0-9a-f-]{36}$/i.test(value)) {
      result[key] = value
    }
  }
  return result
}

const VALID_FUND_SLUGS = new Set<string>(Object.values(FundSlug))

export function loadCoinbaseExportCsv(): CoinbaseCsvPayment[] {
  const csvPath = path.join(process.cwd(), 'coinbase-export.csv')
  if (!fs.existsSync(csvPath)) {
    log('info', '[accounting] coinbase-export.csv not found, skipping')
    return []
  }

  const content = fs.readFileSync(csvPath, 'utf8')
  const lines = content.split(/\r?\n/).filter((l) => l.trim())

  if (lines.length < 5) {
    log('info', '[accounting] coinbase-export.csv has no data rows')
    return []
  }

  const headerLine = lines[2]
  const header = parseCsvLine(headerLine)
  const txCompletedIdx = header.indexOf('TRANSACTION COMPLETED')
  const txTypeIdx = header.indexOf('TRANSACTION TYPE')
  const txIdIdx = header.indexOf('TRANSACTION ID CODE')
  const statusIdx = header.indexOf('STATUS')
  const subtotalCryptoIdx = header.indexOf('SUBTOTAL IN CRYPTO')
  const subtotalFiatIdx = header.indexOf('SUBTOTAL IN FIAT')
  const metadataStartIdx = header.indexOf('METADATA')

  if (
    txCompletedIdx < 0 ||
    txTypeIdx < 0 ||
    txIdIdx < 0 ||
    statusIdx < 0 ||
    subtotalCryptoIdx < 0 ||
    metadataStartIdx < 0
  ) {
    log('warn', '[accounting] coinbase-export.csv missing expected columns')
    return []
  }

  const payments: CoinbaseCsvPayment[] = []

  for (let i = 3; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols.length < metadataStartIdx + 2) continue

    const txType = cols[txTypeIdx]
    const status = cols[statusIdx]
    if (txType !== 'Product Checkout' || status !== 'COMPLETED') continue

    const subtotalCrypto = cols[subtotalCryptoIdx] || ''
    const match = subtotalCrypto.match(/^([\d.]+)\s+(\w+)$/)
    if (!match) continue

    const cryptoAmount = Number(match[1])
    const cryptoCode = match[2]
    if (cryptoAmount <= 0 || cryptoCode !== 'USDC') continue

    const txCompleted = cols[txCompletedIdx]
    const receivedAt = new Date(txCompleted.replace(' UTC', 'Z'))
    if (isNaN(receivedAt.getTime())) continue

    const systemId = cols[cols.length - 2]?.trim() || ''
    const txIdCode = cols[txIdIdx]?.trim() || systemId || `row-${i}`
    const paymentId = `${systemId || txIdCode}`

    const meta = extractMetadataFromCols(cols, metadataStartIdx, cols.length - 2)
    const projectSlug = meta.projectSlug ?? null
    const fundSlugRaw = meta.fundSlug ?? null
    const fundSlug =
      fundSlugRaw && VALID_FUND_SLUGS.has(fundSlugRaw) ? (fundSlugRaw as FundSlug) : null
    const projectName = meta.projectName ?? null

    const subtotalFiatCol = subtotalFiatIdx >= 0 ? cols[subtotalFiatIdx] : ''
    const fiatMatch = subtotalFiatCol.match(/^([\d.]+)/)
    const fiatAmount = fiatMatch ? Number(fiatMatch[1]) : cryptoAmount

    payments.push({
      paymentId,
      invoiceId: systemId || txIdCode,
      receivedAt,
      cryptoCode,
      cryptoAmount,
      cryptoAmountRaw: match[1],
      rate: '1',
      fiatAmount,
      projectSlug,
      projectName,
      fundSlug,
    })
  }

  payments.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  log('info', `[accounting] Loaded ${payments.length} Coinbase donations from coinbase-export.csv`)
  return payments
}
