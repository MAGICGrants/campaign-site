import { log } from '../../utils/logging'
import { btcpayApi } from '../services'
import { BtcPayGetInvoiceRes, BtcPayGetPaymentMethodsRes } from '../types'

export async function getBtcPayInvoice(id: string) {
  try {
    const { data: invoice } = await btcpayApi.get<BtcPayGetInvoiceRes>(`/invoices/${id}`)
    return invoice
  } catch (error) {
    log('error', `Failed to get BTCPayServer invoice ${id}.`)
    throw error
  }
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
