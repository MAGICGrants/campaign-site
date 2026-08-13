import { log } from '../../utils/logging'
import { btcpayApi } from '../services'
import { BtcPayGetInvoiceRes, BtcPayGetPaymentMethodsRes, BtcPayListInvoiceItem } from '../types'

export async function getBtcPayInvoice(id: string) {
  try {
    const { data: invoice } = await btcpayApi.get<BtcPayGetInvoiceRes>(`/invoices/${id}`)
    return invoice
  } catch (error) {
    log('error', `Failed to get BTCPayServer invoice ${id}.`)
    throw error
  }
}

const VALID_EXPIRED_ADDITIONAL_STATUSES = new Set(['PaidPartial', 'PaidOver', 'PaidLate'])

export async function getBtcPayInvoices(options?: {
  startDate?: number
  endDate?: number
}): Promise<BtcPayListInvoiceItem[]> {
  const PAGE_SIZE = 100
  const allInvoices: BtcPayListInvoiceItem[] = []
  let skip = 0

  log('info', options ? `[btcpayserver] Fetching invoices for ${options.startDate}-${options.endDate}...` : '[accounting] Fetching BTCPay invoices...')

  while (true) {
    try {
      const params = new URLSearchParams({
        take: String(PAGE_SIZE),
        skip: String(skip),
      })
      if (options?.startDate != null) params.set('startDate', String(options.startDate))
      if (options?.endDate != null) params.set('endDate', String(options.endDate))
      params.append('status', 'Settled')
      params.append('status', 'Expired')

      const { data: page } = await btcpayApi.get<BtcPayListInvoiceItem[]>(
        `/invoices?${params.toString()}`
      )

      if (page.length === 0) break

      for (const invoice of page) {
        if (invoice.status === 'Settled') {
          allInvoices.push(invoice)
        } else if (
          invoice.status === 'Expired' &&
          VALID_EXPIRED_ADDITIONAL_STATUSES.has(invoice.additionalStatus)
        ) {
          allInvoices.push(invoice)
        }
      }

      skip += page.length
      log('info', `[accounting] Fetched ${skip} invoices, ${allInvoices.length} with payments`)

      if (page.length < PAGE_SIZE) break
    } catch (error) {
      log('error', `[accounting] Failed to fetch BTCPay invoices at offset ${skip}.`)
      throw error
    }
  }

  log('info', `[accounting] Total invoices with payments: ${allInvoices.length}`)
  return allInvoices
}

export async function getBtcPayInvoicePaymentMethods(invoiceId: string) {
  try {
    const { data: paymentMethods } = await btcpayApi.get<BtcPayGetPaymentMethodsRes>(
      `/invoices/${invoiceId}/payment-methods`
    )

    return paymentMethods
  } catch (error) {
    log('error', `Failed to get BTCPayServer payment methods for invoice ${invoiceId}.`)
    throw error
  }
}
