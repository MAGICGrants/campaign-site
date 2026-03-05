import fs from 'fs'
import path from 'path'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from '../server/utils/btcpayserver'
import { getDeposits, getClosedSellOrders } from '../server/utils/kraken'

const startDate = new Date(process.argv[2] || '2025-01-14')
const outDir = process.argv[3] || './analyzer/accounting-dump'

async function main() {
  console.log(`Fetching data from ${startDate.toISOString()}...`)

  fs.mkdirSync(outDir, { recursive: true })

  const invoices = await getBtcPayInvoices()

  // Collect payments by crypto
  const paymentsByCode: Record<string, any[]> = {}

  for (const invoice of invoices) {
    let paymentMethods
    try {
      paymentMethods = await getBtcPayInvoicePaymentMethods(invoice.id)
    } catch {
      continue
    }

    for (const pm of paymentMethods) {
      const code = pm.currency
      if (!['BTC', 'LTC', 'XMR'].includes(code)) continue

      for (const payment of pm.payments) {
        const value = Number(payment.value)
        if (value <= 0) continue
        if (!paymentsByCode[code]) paymentsByCode[code] = []
        paymentsByCode[code].push({
          invoiceId: invoice.id,
          paymentId: payment.id,
          receivedDate: new Date(payment.receivedDate * 1000).toISOString(),
          value: payment.value,
          fee: payment.fee,
          status: payment.status,
          rate: pm.rate,
        })
      }
    }
  }

  // Collect deposits and orders by crypto
  let deposits = await getDeposits(startDate)
  let orders = await getClosedSellOrders(startDate)

  const IGNORED_DEPOSIT_TXIDS: string[] = []
  const IGNORED_ORDER_IDS: string[] = []

  // filter deposits by txid
  deposits = deposits.filter((dep) => !IGNORED_DEPOSIT_TXIDS.includes(dep.txid))
  orders = orders.filter((order) => !IGNORED_ORDER_IDS.includes(order.orderId))

  const depositsByCode: Record<string, any[]> = {}
  for (const dep of deposits) {
    if (!depositsByCode[dep.cryptoCode]) depositsByCode[dep.cryptoCode] = []
    depositsByCode[dep.cryptoCode].push(dep)
  }

  const ordersByCode: Record<string, any[]> = {}
  for (const order of orders) {
    if (!ordersByCode[order.cryptoCode]) ordersByCode[order.cryptoCode] = []
    ordersByCode[order.cryptoCode].push(order)
  }

  const allCodes = [
    ...new Set([
      ...Object.keys(paymentsByCode),
      ...Object.keys(depositsByCode),
      ...Object.keys(ordersByCode),
    ]),
  ].sort()

  for (const code of allCodes) {
    const payments = paymentsByCode[code] || []
    const deps = depositsByCode[code] || []
    const ords = ordersByCode[code] || []

    const paymentTotal = payments.reduce((s: number, p: any) => s + Number(p.value), 0)
    const depositTotal = deps.reduce((s: number, d: any) => s + d.amount, 0)
    const orderTotalCrypto = ords.reduce((s: number, o: any) => s + o.volExec, 0)
    const orderTotalUsd = ords.reduce((s: number, o: any) => s + o.netProceeds, 0)

    console.log(`=== ${code} ===`)
    console.log(`  Payments:  ${payments.length} payments, ${paymentTotal} ${code}`)
    console.log(`  Deposits:  ${deps.length} deposits, ${depositTotal} ${code}`)
    console.log(
      `  Orders:    ${ords.length} orders, ${orderTotalCrypto} ${code}, $${orderTotalUsd.toFixed(2)} USD`
    )
    console.log()

    const codeDir = path.join(outDir, code.toLowerCase())
    fs.mkdirSync(codeDir, { recursive: true })

    payments.sort(
      (a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime()
    )
    deps.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime())
    ords.sort((a: any, b: any) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime())

    fs.writeFileSync(path.join(codeDir, 'payments.json'), JSON.stringify(payments, null, 2))
    fs.writeFileSync(path.join(codeDir, 'deposits.json'), JSON.stringify(deps, null, 2))
    fs.writeFileSync(path.join(codeDir, 'orders.json'), JSON.stringify(ords, null, 2))

    console.log(`  Written to ${codeDir}/`)
    console.log()
  }
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
