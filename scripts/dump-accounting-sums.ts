import fs from 'fs'
import path from 'path'
import { getBtcPayInvoices, getBtcPayInvoicePaymentMethods } from '../server/utils/btcpayserver'
import { getDeposits, getClosedSellOrders } from '../server/utils/kraken'
import { prisma } from '../server/services'

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

  const ignoreRecords = await prisma.accountingIgnore.findMany()
  const ignoredDepositTxids = new Set(
    ignoreRecords.filter((r) => r.type === 'deposit').map((r) => r.value)
  )
  const ignoredOrderIds = new Set(
    ignoreRecords.filter((r) => r.type === 'order').map((r) => r.value)
  )

  deposits = deposits.filter((dep) => !ignoredDepositTxids.has(dep.txid))
  orders = orders.filter((order) => !ignoredOrderIds.has(order.orderId))

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

    let sum = 0
    for (const p of payments) {
      sum += Number(p.value)
      p.sumSoFar = sum
    }
    sum = 0
    for (const d of deps) {
      sum += d.amount
      d.sumSoFar = sum
    }
    let sumCrypto = 0
    let sumUsd = 0
    for (const o of ords) {
      sumCrypto += o.volExec
      sumUsd += o.netProceeds
      o.sumSoFar = sumCrypto
      o.sumSoFarUsd = sumUsd
    }

    fs.writeFileSync(path.join(codeDir, 'payments.json'), JSON.stringify(payments, null, 2))
    fs.writeFileSync(path.join(codeDir, 'deposits.json'), JSON.stringify(deps, null, 2))
    fs.writeFileSync(path.join(codeDir, 'orders.json'), JSON.stringify(ords, null, 2))

    // Build merged timeline: one item per payment/deposit/order with diffs
    type TimelineEvent = {
      date: string
      type: 'payment' | 'deposit' | 'order'
      amount: number
      paymentTotal: number
      depositTotal: number
      orderTotal: number
      diffPaymentsDeposits: number
      diffDepositsOrders: number
      item: any
    }
    const events: {
      date: Date
      type: 'payment' | 'deposit' | 'order'
      amount: number
      item: any
    }[] = []
    for (const p of payments) {
      events.push({
        date: new Date(p.receivedDate),
        type: 'payment',
        amount: Number(p.value),
        item: p,
      })
    }
    for (const d of deps) {
      events.push({ date: new Date(d.time), type: 'deposit', amount: d.amount, item: d })
    }
    for (const o of ords) {
      events.push({ date: new Date(o.closedAt), type: 'order', amount: o.volExec, item: o })
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime())

    let payTotal = 0
    let depTotal = 0
    let ordTotal = 0
    const diffs: TimelineEvent[] = []
    for (const e of events) {
      if (e.type === 'payment') payTotal += e.amount
      else if (e.type === 'deposit') depTotal += e.amount
      else ordTotal += e.amount
      diffs.push({
        date: e.date.toISOString(),
        type: e.type,
        amount: e.amount,
        paymentTotal: payTotal,
        depositTotal: depTotal,
        orderTotal: ordTotal,
        diffPaymentsDeposits: payTotal - depTotal,
        diffDepositsOrders: depTotal - ordTotal,
        item: e.item,
      })
    }
    fs.writeFileSync(path.join(codeDir, 'diffs.json'), JSON.stringify(diffs, null, 2))

    console.log(`  Written to ${codeDir}/`)
    console.log()
  }

  // Dump from DonationAccounting records (same output structure)
  const records = await prisma.donationAccounting.findMany({
    where: { paymentReceivedAt: { gte: startDate } },
    orderBy: { paymentReceivedAt: 'asc' },
  })

  const daByCode: Record<string, typeof records> = {}
  for (const r of records) {
    if (!['BTC', 'LTC', 'XMR'].includes(r.cryptoCode)) continue
    if (!daByCode[r.cryptoCode]) daByCode[r.cryptoCode] = []
    daByCode[r.cryptoCode].push(r)
  }

  const daOutDir = path.join(outDir, 'donation-accounting')
  for (const code of Object.keys(daByCode).sort()) {
    const recs = daByCode[code]

    const payments = recs.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      invoiceId: r.invoiceId,
      receivedDate: r.paymentReceivedAt.toISOString(),
      value: r.cryptoAmount,
      rate: r.rate,
      fiatAmount: r.fiatAmount,
      projectSlug: r.projectSlug,
      projectName: r.projectName,
      fundSlug: r.fundSlug,
      source: r.source,
    }))

    const deposits: any[] = []
    for (const r of recs) {
      const deps =
        (r.krakenDeposits as { txid: string; time: string; matchedCrypto: number }[]) || []
      for (const d of deps) {
        deposits.push({
          txid: d.txid,
          time: d.time,
          amount: d.matchedCrypto,
          paymentId: r.paymentId,
        })
      }
    }

    const orders: any[] = []
    for (const r of recs) {
      const ords =
        (r.krakenOrders as {
          orderId: string
          closedAt: string
          matchedCrypto: number
          matchedUsd: number
        }[]) || []
      for (const o of ords) {
        orders.push({
          orderId: o.orderId,
          closedAt: o.closedAt,
          volExec: o.matchedCrypto,
          netProceeds: o.matchedUsd,
          paymentId: r.paymentId,
        })
      }
    }

    payments.sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime())
    deposits.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    orders.sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime())

    let sum = 0
    for (const p of payments) {
      sum += Number(p.value)
      ;(p as any).sumSoFar = sum
    }
    sum = 0
    for (const d of deposits) {
      sum += d.amount
      d.sumSoFar = sum
    }
    let sumCrypto = 0
    let sumUsd = 0
    for (const o of orders) {
      sumCrypto += o.volExec
      sumUsd += o.netProceeds
      o.sumSoFar = sumCrypto
      o.sumSoFarUsd = sumUsd
    }

    const codeDir = path.join(daOutDir, code.toLowerCase())
    fs.mkdirSync(codeDir, { recursive: true })
    fs.writeFileSync(path.join(codeDir, 'payments.json'), JSON.stringify(payments, null, 2))
    fs.writeFileSync(path.join(codeDir, 'deposits.json'), JSON.stringify(deposits, null, 2))
    fs.writeFileSync(path.join(codeDir, 'orders.json'), JSON.stringify(orders, null, 2))

    type TimelineEvent = {
      date: string
      type: 'payment' | 'deposit' | 'order'
      amount: number
      paymentTotal: number
      depositTotal: number
      orderTotal: number
      diffPaymentsDeposits: number
      diffDepositsOrders: number
      item: any
    }
    const events: {
      date: Date
      type: 'payment' | 'deposit' | 'order'
      amount: number
      item: any
    }[] = []
    for (const p of payments) {
      events.push({
        date: new Date(p.receivedDate),
        type: 'payment',
        amount: Number(p.value),
        item: p,
      })
    }
    for (const d of deposits) {
      events.push({ date: new Date(d.time), type: 'deposit', amount: d.amount, item: d })
    }
    for (const o of orders) {
      events.push({ date: new Date(o.closedAt), type: 'order', amount: o.volExec, item: o })
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime())

    let payTotal = 0
    let depTotal = 0
    let ordTotal = 0
    const diffs: TimelineEvent[] = []
    for (const e of events) {
      if (e.type === 'payment') payTotal += e.amount
      else if (e.type === 'deposit') depTotal += e.amount
      else ordTotal += e.amount
      diffs.push({
        date: e.date.toISOString(),
        type: e.type,
        amount: e.amount,
        paymentTotal: payTotal,
        depositTotal: depTotal,
        orderTotal: ordTotal,
        diffPaymentsDeposits: payTotal - depTotal,
        diffDepositsOrders: depTotal - ordTotal,
        item: e.item,
      })
    }
    fs.writeFileSync(path.join(codeDir, 'diffs.json'), JSON.stringify(diffs, null, 2))

    const paymentTotal = payments.reduce((s: number, p: any) => s + Number(p.value), 0)
    const depositTotal = deposits.reduce((s: number, d: any) => s + d.amount, 0)
    const orderTotalCrypto = orders.reduce((s: number, o: any) => s + o.volExec, 0)
    const orderTotalUsd = orders.reduce((s: number, o: any) => s + o.netProceeds, 0)

    console.log(`=== DonationAccounting ${code} ===`)
    console.log(`  Payments:  ${payments.length} records, ${paymentTotal} ${code}`)
    console.log(`  Deposits:  ${deposits.length} portions, ${depositTotal} ${code}`)
    console.log(
      `  Orders:    ${orders.length} portions, ${orderTotalCrypto} ${code}, $${orderTotalUsd.toFixed(2)} USD`
    )
    console.log(`  Written to ${codeDir}/`)

    // Compare: payments in BTCPay but not in DonationAccounting
    const btcPayPayments = paymentsByCode[code] || []
    const daPaymentIds = new Set(recs.map((r) => r.paymentId).filter(Boolean))
    const missing = btcPayPayments.filter((p: any) => !daPaymentIds.has(p.paymentId))
    if (missing.length > 0) {
      fs.writeFileSync(
        path.join(codeDir, 'missing-from-donation-accounting.json'),
        JSON.stringify(missing, null, 2)
      )
      console.log(
        `  ⚠ ${missing.length} BTCPay payments not in DonationAccounting → missing-from-donation-accounting.json`
      )
    }
    console.log()
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Failed:', err)
    prisma.$disconnect()
    process.exit(1)
  })
