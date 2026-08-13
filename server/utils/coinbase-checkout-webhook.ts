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
  if (!signatureHeader) return false;
  try {
    // Parse signature header: t=timestamp,h=headers,v1=signature
    const elements = signatureHeader.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
    const headerNames = elements.find(e => e.startsWith('h='))?.split('=')[1];
    const providedSignature = elements.find(e => e.startsWith('v1='))?.split('=')[1];
    
    // Build header values string
    const headerNameList = headerNames?.split(' ') || [];
    const headerValues = headerNameList.map(name => headers[name] || '').join('.');
    
    // Build signed payload
    const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${payload}`;
    
    // Compute expected signature
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload, 'utf8')
        .digest('hex');
    
    // Compare signatures securely
    const signaturesMatch = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature || '', 'hex')
    );
    
    // Verify timestamp to prevent replay attacks
    const webhookTime = parseInt(timestamp || '0') * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const ageMinutes = (currentTime - webhookTime) / (1000 * 60);
    
    if (ageMinutes > maxAgeMinutes) {
        console.error(`Webhook timestamp exceeds maximum age: ${ageMinutes.toFixed(1)} minutes > ${maxAgeMinutes} minutes`);
        return false;
    }
    
    return signaturesMatch;
    
} catch (error) {
    console.error('Webhook verification error:', error);
    return false;
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
  settlement: {
    totalAmount: string
    feeAmount: string
    netAmount: string
    currency: string
  }
  network?: string
}
