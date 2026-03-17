import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const prisma = new PrismaClient()

const NET_DONATION_AMOUNT_WITH_POINTS_RATE = 0.9

const btcpayApi = axios.create({
  baseURL: `${process.env.BTCPAY_URL}/api/v1/stores/${process.env.BTCPAY_STORE_ID}`,
  headers: { Authorization: `token ${process.env.BTCPAY_API_KEY}` },
})

type BtcPayPaymentMethod = {
  rate: string
  amount: string
  currency: 'BTC' | 'XMR' | 'LTC'
  paymentMethodPaid: string
  destination: string
}

type OldCryptoPayment = {
  cryptoCode: string
  grossAmount: number | string
  netAmount: number | string
  rate: number | string
  txId?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPaymentMethods(invoiceId: string): Promise<BtcPayPaymentMethod[] | null> {
  try {
    const { data } = await btcpayApi.get<BtcPayPaymentMethod[]>(
      `/invoices/${invoiceId}/payment-methods`
    )
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data?.code === 'invoice-not-found') {
      console.warn(`  Invoice ${invoiceId} not found, falling back to String() conversion`)
      return null
    }
    console.warn(
      `  Failed to fetch payment methods for invoice ${invoiceId}: ${err instanceof Error ? err.message : err}`
    )
    return null
  }
}

async function main() {
  if (!process.env.BTCPAY_URL || !process.env.BTCPAY_STORE_ID || !process.env.BTCPAY_API_KEY) {
    console.error('Missing BTCPAY_URL, BTCPAY_STORE_ID, or BTCPAY_API_KEY env vars')
    process.exit(1)
  }

  const donations = await prisma.donation.findMany({
    where: {
      btcPayInvoiceId: { not: null },
      cryptoPayments: { not: { isEmpty: false } },
    },
    select: {
      id: true,
      btcPayInvoiceId: true,
      cryptoPayments: true,
      pointsAdded: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${donations.length} BTCPay donations with cryptoPayments`)

  // Group donations by invoice to avoid redundant API calls
  const byInvoice = new Map<string, typeof donations>()
  for (const d of donations) {
    const key = d.btcPayInvoiceId!
    const group = byInvoice.get(key) || []
    group.push(d)
    byInvoice.set(key, group)
  }

  console.log(`${byInvoice.size} unique invoices to fetch`)

  let updated = 0
  let skipped = 0
  let invoiceIdx = 0

  for (const [invoiceId, invoiceDonations] of byInvoice) {
    invoiceIdx++

    const paymentMethods = await fetchPaymentMethods(invoiceId)

    // Build a lookup: currency -> payment method data
    const methodByCurrency = new Map<string, BtcPayPaymentMethod>()
    if (paymentMethods) {
      for (const pm of paymentMethods) {
        if (Number(pm.paymentMethodPaid) > 0) {
          methodByCurrency.set(pm.currency, pm)
        }
      }
    }

    const isSingleDonationInvoice = invoiceDonations.length === 1

    for (const donation of invoiceDonations) {
      const payments = donation.cryptoPayments as OldCryptoPayment[] | null
      if (!payments || payments.length === 0) {
        skipped++
        continue
      }

      const hadPoints = donation.pointsAdded > 0

      const migrated = payments.map((p) => {
        if (p.cryptoCode === 'MANUAL') {
          return {
            ...p,
            grossAmount: String(p.grossAmount),
            netAmount: String(p.netAmount),
            rate: String(p.rate),
          }
        }

        const pm = methodByCurrency.get(p.cryptoCode)
        if (!pm) {
          // No matching payment method from BTCPay, fall back to String()
          return {
            ...p,
            grossAmount: String(p.grossAmount),
            netAmount: String(p.netAmount),
            rate: String(p.rate),
          }
        }

        const grossAmount = isSingleDonationInvoice
          ? pm.paymentMethodPaid
          : String(p.grossAmount)

        const grossNum = Number(grossAmount)
        const netAmount = hadPoints
          ? String(grossNum * NET_DONATION_AMOUNT_WITH_POINTS_RATE)
          : grossAmount

        // Funding API invoices use a rate fetched separately at payment time,
        // so keep the existing rate rather than using the payment method rate
        const rate = isSingleDonationInvoice ? pm.rate : String(p.rate)

        return {
          ...p,
          grossAmount,
          netAmount,
          rate,
        }
      })

      await prisma.donation.update({
        where: { id: donation.id },
        data: { cryptoPayments: migrated },
      })

      updated++
    }

    if (invoiceIdx % 20 === 0) {
      console.log(
        `Progress: ${invoiceIdx}/${byInvoice.size} invoices, ${updated} updated, ${skipped} skipped`
      )
    }

    // Small delay to avoid hammering the BTCPay API
    await sleep(100)
  }

  console.log(
    `Done. ${updated} updated, ${skipped} skipped.`
  )
}

main()
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
