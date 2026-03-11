import { generateJwt } from '@coinbase/cdp-sdk/auth'

import { env } from '../../env.mjs'
import { log } from '../../utils/logging'
import { coinbaseCdpApi } from '../services'

export type CoinbaseCdpInvoice = {
  uuid: string
  invoiceNumber: string
  contactName: string
  contactEmail: string
  totalAmountDue: { value: string; currency: string }
  status: string
  createdAt: string
  updatedAt: string
  lineItems?: Array<{
    itemName: string
    quantity: number
    unitPrice: { value: string; currency: string }
  }>
  paymentMethod?: {
    crypto?: {
      paymentLinkUrl?: string
      paymentLinkId?: string
      transactionHash?: string
    }
  }
  memo?: string
  privateNotes?: string
}

type ListInvoicesResponse = {
  invoices: CoinbaseCdpInvoice[]
  nextPageToken?: string
}

async function getBearerToken(endpoint: string): Promise<string> {
  const token = await generateJwt({
    apiKeyId: env.COINBASE_CDP_API_KEY_ID!,
    apiKeySecret: env.COINBASE_CDP_API_KEY_PRIVATE_KEY!,
    requestMethod: 'GET',
    requestHost: 'business.coinbase.com',
    requestPath: `/api/v1${endpoint}`,
    expiresIn: 120,
  })
  return token
}

export async function getCoinbaseCdpInvoices(): Promise<CoinbaseCdpInvoice[]> {
  const allInvoices: CoinbaseCdpInvoice[] = []
  let pageToken: string | undefined

  log('info', '[accounting] Fetching Coinbase CDP invoices...')

  do {
    const token = await getBearerToken('/invoices')
    const params = new URLSearchParams({ pageSize: '100' })
    if (pageToken) params.set('pageToken', pageToken)

    const { data } = await coinbaseCdpApi.get<ListInvoicesResponse>(
      `/invoices?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    console.log(data)

    allInvoices.push(...data.invoices)
    pageToken = data.nextPageToken

    log('info', `[accounting] Fetched ${allInvoices.length} Coinbase invoices so far`)
  } while (pageToken)

  log('info', `[accounting] Total Coinbase CDP invoices: ${allInvoices.length}`)
  return allInvoices
}
