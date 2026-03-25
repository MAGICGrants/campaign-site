import crypto from 'crypto'
import type { IncomingHttpHeaders } from 'http'

import type { FundSlug, MembershipTerm } from '@prisma/client'

import { fundSlugs } from '../../utils/funds'
import type { DonationMetadata } from '../types'

/** Verifies `X-Hook0-Signature` from CDP webhook subscriptions (Checkout / Payment Link events). */
export function verifyCoinbaseCdpHookSignature(
  payload: string,
  signatureHeader: string | undefined,
  secret: string,
  headers: IncomingHttpHeaders,
  maxAgeMinutes = 5
): boolean {
  if (!signatureHeader) return false
  try {
    const elements = signatureHeader.split(',')
    const tEl = elements.find((e) => e.trim().startsWith('t='))
    const hEl = elements.find((e) => e.trim().startsWith('h='))
    const v1El = elements.find((e) => e.trim().startsWith('v1='))
    if (!tEl || !hEl || !v1El) return false

    const timestamp = tEl.split('=').slice(1).join('=').trim()
    const headerNames = hEl.split('=').slice(1).join('=').trim()
    const providedSignature = v1El.split('=').slice(1).join('=').trim()

    const headerNameList = headerNames.split(/\s+/).filter(Boolean)
    const headerValues = headerNameList
      .map((name) => {
        const lower = name.toLowerCase()
        const v = headers[lower] ?? headers[name]
        if (Array.isArray(v)) return v[0] ?? ''
        return v ?? ''
      })
      .join('.')

    const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${payload}`

    const expectedSignature = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')

    const a = Buffer.from(expectedSignature, 'hex')
    const b = Buffer.from(providedSignature, 'hex')
    if (a.length !== b.length) return false
    if (!crypto.timingSafeEqual(a, b)) return false

    const webhookTime = parseInt(timestamp, 10) * 1000
    const ageMinutes = (Date.now() - webhookTime) / (1000 * 60)
    if (ageMinutes > maxAgeMinutes || ageMinutes < -1) return false

    return true
  } catch {
    return false
  }
}

function isFundSlug(s: string): s is FundSlug {
  return (fundSlugs as readonly string[]).includes(s)
}

export function checkoutMetadataToDonationMetadata(
  meta: Record<string, string> | undefined
): DonationMetadata | null {
  if (!meta || Object.keys(meta).length === 0) return null

  const fundSlug = meta.fundSlug
  if (!fundSlug || !isFundSlug(fundSlug)) return null
  if (!meta.projectSlug?.trim()) return null

  const membershipRaw = meta.membershipTerm
  let membershipTerm: MembershipTerm | null = null
  if (membershipRaw === 'monthly' || membershipRaw === 'annually') {
    membershipTerm = membershipRaw
  }

  return {
    userId: meta.userId?.trim() ? meta.userId : null,
    donorEmail: meta.donorEmail?.trim() ? meta.donorEmail : null,
    donorName: meta.donorName?.trim() ? meta.donorName : null,
    donorNameIsProfane: meta.donorNameIsProfane === 'true' ? 'true' : 'false',
    projectSlug: meta.projectSlug || '',
    projectName: meta.projectName || '',
    fundSlug,
    itemDesc: meta.itemDesc || undefined,
    isMembership: meta.isMembership === 'true' ? 'true' : 'false',
    membershipTerm,
    isSubscription: meta.isSubscription === 'true' ? 'true' : 'false',
    isTaxDeductible: meta.isTaxDeductible === 'true' ? 'true' : 'false',
    staticGeneratedForApi: meta.staticGeneratedForApi === 'true' ? 'true' : 'false',
    givePointsBack: meta.givePointsBack === 'true' ? 'true' : 'false',
    showDonorNameOnLeaderboard: meta.showDonorNameOnLeaderboard === 'true' ? 'true' : 'false',
  }
}

export type CheckoutWebhookPayload = {
  eventType:
    | 'checkout.payment.success'
    | 'checkout.payment.failed'
    | 'checkout.payment.expired'
    | 'payment_link.payment.success'
    | 'payment_link.payment.failed'
    | 'payment_link.payment.expired'
    | string
  id: string
  amount: string
  currency: string
  status: string
  metadata?: Record<string, string>
  settlement?: {
    totalAmount: string
    feeAmount: string
    netAmount: string
    currency?: string
  }
  network?: string
}
