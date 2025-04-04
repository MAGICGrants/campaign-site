import { AxiosResponse } from 'axios'
import { printfulApi, prisma, strapiApi } from '../services'
import {
  PrintfulCreateOrderReq,
  PrintfulCreateOrderRes,
  PrintfulEstimateOrderReq,
  PrintfulEstimateOrderRes,
  StrapiCreateOrderBody,
  StrapiCreateOrderRes,
  StrapiCreatePointBody,
  StrapiGetPointsPopulatedRes,
} from '../types'
import { Donation } from '@prisma/client'

type Shipping = {
  addressLine1: string
  addressLine2?: string
  city: string
  stateCode: string
  countryCode: string
  zip: string
  phone: string
  taxNumber?: string
}

export async function getPointsBalance(userId: string): Promise<number> {
  const {
    data: { data: pointHistory },
  } = await strapiApi.get<StrapiGetPointsPopulatedRes>(
    `/points?filters[userId][$eq]=${userId}&sort=createdAt:desc&populate=*`
  )

  const lastPointHistory = pointHistory[0]
  const currentBalance = lastPointHistory ? Number(lastPointHistory.balance) : 0

  return currentBalance
}

type GivePointsToUserParams = { pointsToGive: number; donation: Donation }

export async function givePointsToUser({ pointsToGive, donation }: GivePointsToUserParams) {
  if (!donation.userId) {
    console.error(
      'Could not give points using donation with null userId. Donation ID:',
      donation.userId
    )
    return
  }

  const pointsBalance = await getPointsBalance(donation.userId)

  await strapiApi.post<any, any, StrapiCreatePointBody>('/points', {
    data: {
      balanceChange: pointsToGive.toString(),
      balance: (pointsBalance + pointsToGive).toString(),
      userId: donation.userId,
      donationId: donation.id,
      donationProjectName: donation.projectName,
      donationProjectSlug: donation.projectSlug,
      donationFundSlug: donation.fundSlug,
    },
  })
}

type DeductPointsFromUserParams = {
  deductionAmount: number
  userId: string
  perkId: string
  orderId: string
}

export async function deductPointsFromUser({
  deductionAmount,
  userId,
  perkId,
  orderId,
}: DeductPointsFromUserParams) {
  const pointsBalance = await getPointsBalance(userId)
  const newPointsBalance = pointsBalance - deductionAmount

  await strapiApi.post<any, any, StrapiCreatePointBody>('/points', {
    data: {
      balanceChange: (-deductionAmount).toString(),
      balance: newPointsBalance.toString(),
      userId: userId,
      perk: perkId,
      order: orderId,
    },
  })
}

export type CreateStrapiOrderParams = {
  perkId: string
  userId: string
  userEmail: string
  shipping?: Shipping
}

export async function createStrapiOrder({
  perkId,
  userId,
  userEmail,
  shipping,
}: CreateStrapiOrderParams) {
  const {
    data: { data: order },
  } = await strapiApi.post<any, AxiosResponse<StrapiCreateOrderRes>, StrapiCreateOrderBody>(
    '/orders',
    {
      data: {
        perk: perkId,
        userId: userId,
        userEmail: userEmail,
        shippingAddressLine1: shipping?.addressLine1,
        shippingAddressLine2: shipping?.addressLine2,
        shippingCity: shipping?.city,
        shippingState: shipping?.stateCode,
        shippingCountry: shipping?.countryCode,
        shippingZip: shipping?.zip,
        shippingPhone: shipping?.phone,
      },
    }
  )

  return order
}

export async function deleteStrapiOrder(orderId: string) {
  await strapiApi.delete(`/orders/${orderId}`)
}

type EstimatePrintfulOrderCostParams = {
  email: string
  name: string
  printfulSyncVariantId: number
  shipping: Shipping
}

export async function estimatePrintfulOrderCost({
  printfulSyncVariantId,
  email,
  name,
  shipping,
}: EstimatePrintfulOrderCostParams) {
  const {
    data: { result: costEstimate },
  } = await printfulApi.post<{}, AxiosResponse<PrintfulEstimateOrderRes>, PrintfulEstimateOrderReq>(
    `/orders/estimate-costs`,
    {
      recipient: {
        address1: shipping.addressLine1,
        address2: shipping.addressLine2 || '',
        city: shipping.city,
        state_code: shipping.stateCode,
        country_code: shipping.countryCode,
        zip: shipping.zip,
        phone: shipping.phone,
        tax_number: shipping.taxNumber,
        email,
        name,
      },
      items: [{ quantity: 1, sync_variant_id: printfulSyncVariantId }],
    }
  )

  return costEstimate
}

type CreatePrintfulOrderParams = {
  email: string
  name: string
  printfulSyncVariantId: number
  shipping: Shipping
}

export async function createPrintfulOrder({
  printfulSyncVariantId,
  email,
  name,
  shipping,
}: CreatePrintfulOrderParams) {
  const { data } = await printfulApi.post<
    {},
    AxiosResponse<PrintfulCreateOrderRes>,
    PrintfulCreateOrderReq
  >(process.env.NODE_ENV === 'production' ? '/orders?confirm=true' : '/orders', {
    recipient: {
      name,
      email,
      address1: shipping.addressLine1,
      address2: shipping?.addressLine2 || '',
      city: shipping.city,
      state_code: shipping.stateCode,
      country_code: shipping.countryCode!,
      zip: shipping.zip,
      phone: shipping.phone,
      tax_number: shipping.taxNumber,
    },
    items: [{ quantity: 1, sync_variant_id: printfulSyncVariantId }],
  })

  return data
}

export async function cancelPrintfulOrder(id: string) {
  await printfulApi.delete(`/orders/${id}`)
}
