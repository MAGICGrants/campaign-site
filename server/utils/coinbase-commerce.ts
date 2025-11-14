import { FundSlug } from '@prisma/client'
import { DonationMetadata } from '../types'
import { coinbaseCommerceApi } from '../services'
import { env } from '../../env.mjs'
import { AxiosResponse } from 'axios'

type CreateCoinbaseChargeFunParams = {
  amountUsd: number
  metadata: DonationMetadata
  fundSlug: FundSlug
}

type CreateCoinbaseChargeBody = {
  cancel_url?: string
  redirect_url?: string
  local_price: {
    amount: string
    currency: string
  }
  pricing_type: 'fixed_price' | 'no_price'
  metadata: DonationMetadata
}

type CreateCoinbaseChargeRes = {
  data: {
    hosted_url: string
  }
}

export async function createCoinbaseCharge({ amountUsd, metadata }: CreateCoinbaseChargeFunParams) {
  const {
    data: { data },
  } = await coinbaseCommerceApi.post<
    any,
    AxiosResponse<CreateCoinbaseChargeRes>,
    CreateCoinbaseChargeBody
  >('/charges', {
    local_price: { amount: amountUsd.toString(), currency: 'usd' },
    pricing_type: 'fixed_price',
    metadata,
    redirect_url: `${env.APP_URL}/${metadata.fundSlug}/thankyou`,
    cancel_url: `${env.APP_URL}/${metadata.fundSlug}`,
  })

  return data
}
