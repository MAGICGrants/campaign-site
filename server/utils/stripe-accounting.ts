import { FundSlug, Prisma } from '@prisma/client'
import Stripe from 'stripe'

import { prisma, stripe as stripeClients } from '../services'

export function balanceTransactionToUsd(
  bt: { currency: string; fee?: number; net?: number; exchange_rate?: number | null },
  grossCents: number
): { fee: number; net: number } {
  if (!bt) return { fee: 0, net: grossCents / 100 }
  const feeInt = bt.fee ?? 0
  const netInt = bt.net ?? grossCents
  const currency = (bt.currency ?? 'usd').toLowerCase()
  const rate = currency === 'usd' ? 1 : (bt.exchange_rate ?? 0)
  if (rate <= 0 && currency !== 'usd') return { fee: 0, net: grossCents / 100 }
  return {
    fee: feeInt / rate / 100,
    net: netInt / rate / 100,
  }
}

export type BalanceTransactionLike = {
  currency: string
  fee?: number
  net?: number
  exchange_rate?: number | null
}

/** Extract balance_transaction and paymentId from invoice payments (Stripe 2026+ API) */
export function getInvoicePaymentInfo(inv: Stripe.Invoice): {
  balanceTransaction: BalanceTransactionLike | null
  paymentId: string
} {
  const paymentId = inv.id
  let balanceTransaction: BalanceTransactionLike | null = null

  const payments = inv.payments?.data
  if (payments && Array.isArray(payments)) {
    const paidPayment = payments.find((p) => p.status === 'paid')
    const p = paidPayment?.payment
    if (p) {
      if (p.type === 'payment_intent' && p.payment_intent) {
        const pi = typeof p.payment_intent === 'object' ? p.payment_intent : null
        if (pi) {
          const charge = pi.latest_charge
          const chargeObj = charge && typeof charge === 'object' ? charge : null
          const bt = chargeObj?.balance_transaction
          balanceTransaction =
            bt && typeof bt === 'object' && bt !== null && 'currency' in bt
              ? (bt as BalanceTransactionLike)
              : null
          return { balanceTransaction, paymentId: pi.id }
        }
      }
      if (p.type === 'charge' && p.charge) {
        const charge = typeof p.charge === 'object' ? p.charge : null
        if (charge) {
          const bt = charge.balance_transaction
          balanceTransaction =
            bt && typeof bt === 'object' && bt !== null && 'currency' in bt
              ? (bt as BalanceTransactionLike)
              : null
          return { balanceTransaction, paymentId: charge.id }
        }
      }
    }
  }
  return { balanceTransaction, paymentId }
}

/** Fetch balance_transaction via extra API calls when expand limit prevents inline inclusion */
export async function fetchInvoiceBalanceTransaction(
  inv: Stripe.Invoice,
  stripeClient: Stripe
): Promise<{ balanceTransaction: BalanceTransactionLike | null; paymentId: string }> {
  const fromExpand = getInvoicePaymentInfo(inv)
  if (fromExpand.balanceTransaction) return fromExpand

  const payments = inv.payments?.data
  if (!payments?.length) return fromExpand

  const paidPayment = payments.find((p) => p.status === 'paid')
  const p = paidPayment?.payment as
    | { type?: string; payment_intent?: string | { id?: string }; charge?: string | { id?: string } }
    | undefined
  if (!p) return fromExpand

  try {
    if (p.type === 'payment_intent' && p.payment_intent) {
      const piId =
        typeof p.payment_intent === 'string' ? p.payment_intent : p.payment_intent?.id
      if (!piId) return fromExpand
      const pi = await stripeClient.paymentIntents.retrieve(piId, {
        expand: ['latest_charge.balance_transaction'],
      })
      const charge = pi.latest_charge
      const chargeObj = charge && typeof charge === 'object' ? charge : null
      const bt = chargeObj?.balance_transaction
      const balanceTransaction =
        bt && typeof bt === 'object' && bt !== null && 'currency' in bt
          ? (bt as BalanceTransactionLike)
          : null
      return { balanceTransaction, paymentId: pi.id }
    }
    if (p.type === 'charge' && p.charge) {
      const chId = typeof p.charge === 'string' ? p.charge : p.charge?.id
      if (!chId) return fromExpand
      const charge = await stripeClient.charges.retrieve(chId, {
        expand: ['balance_transaction'],
      })
      const bt = charge.balance_transaction
      const balanceTransaction =
        bt && typeof bt === 'object' && bt !== null && 'currency' in bt
          ? (bt as BalanceTransactionLike)
          : null
      return { balanceTransaction, paymentId: charge.id }
    }
  } catch {
    // Fall through to return fromExpand (fee: 0)
  }
  return fromExpand
}

const emptyKrakenJson: Prisma.InputJsonValue = []

/**
 * Upsert paid Stripe invoices and one-off payment intents into DonationAccounting.
 * Called from the accounting worker; listByDateRange reads these rows from the DB.
 */
export async function syncStripeDonationAccounting(opts: {
  startTs: number
  endTs: number
}): Promise<{ upserted: number }> {
  const { startTs, endTs } = opts
  let upserted = 0
  const fundSlugs = Object.keys(stripeClients) as FundSlug[]

  for (const fundSlug of fundSlugs) {
    const stripeClient = stripeClients[fundSlug]

    const invoices: Stripe.Invoice[] = []
    for await (const inv of stripeClient.invoices.list({
      created: { gte: startTs, lt: endTs },
      status: 'paid',
      limit: 100,
      expand: ['data.parent', 'data.payments.data.payment'],
    })) {
      const meta =
        (inv.parent?.subscription_details as { metadata?: Record<string, string> } | null)
          ?.metadata ?? (inv.metadata as Record<string, string> | null)
      if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
      invoices.push(inv)
    }

    const btResults = await Promise.all(
      invoices.map((inv) => fetchInvoiceBalanceTransaction(inv, stripeClient))
    )

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]
      const meta =
        (inv.parent?.subscription_details as { metadata?: Record<string, string> } | null)
          ?.metadata ?? (inv.metadata as Record<string, string> | null)
      if (!meta) continue

      const grossCents = inv.amount_paid ?? inv.total ?? 0
      const grossFiatAmount = grossCents / 100
      const { balanceTransaction: btObj, paymentId } = btResults[i]
      const { fee, net: netFiatAmount } = btObj
        ? balanceTransactionToUsd(btObj, grossCents)
        : { fee: 0, net: grossFiatAmount }

      await prisma.donationAccounting.upsert({
        where: { paymentId },
        create: {
          source: 'stripe',
          paymentId,
          invoiceId: inv.id,
          paymentReceivedAt: new Date(inv.created * 1000),
          cryptoCode: 'USD',
          cryptoAmount: '-',
          rate: '1',
          fiatAmount: grossFiatAmount,
          fiatProcessorFee: fee,
          cryptoProcessorFee: null,
          krakenDeposits: emptyKrakenJson,
          krakenOrders: emptyKrakenJson,
          totalRealizedUsd: netFiatAmount,
          projectSlug: meta.projectSlug,
          projectName: meta.projectName ?? 'General',
          fundSlug: meta.fundSlug as FundSlug,
        },
        update: {
          invoiceId: inv.id,
          paymentReceivedAt: new Date(inv.created * 1000),
          fiatAmount: grossFiatAmount,
          fiatProcessorFee: fee,
          totalRealizedUsd: netFiatAmount,
          projectSlug: meta.projectSlug,
          projectName: meta.projectName ?? 'General',
          fundSlug: meta.fundSlug as FundSlug,
        },
      })
      upserted++
    }

    for await (const pi of stripeClient.paymentIntents.list({
      created: { gte: startTs, lt: endTs },
      limit: 100,
      expand: ['data.latest_charge.balance_transaction'],
    })) {
      if (pi.status !== 'succeeded' || !pi.amount_received || pi.amount_received <= 0) continue
      const meta = pi.metadata as Record<string, string> | null
      if (!meta?.projectSlug || !meta?.fundSlug || meta.fundSlug !== fundSlug) continue
      if (meta.isSubscription === 'true') continue

      const grossCents = pi.amount_received
      const grossFiatAmount = grossCents / 100
      const charge = pi.latest_charge
      const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null
      const btObj = bt && typeof bt === 'object' ? bt : null
      const { fee, net: netFiatAmount } = btObj
        ? balanceTransactionToUsd(btObj as BalanceTransactionLike, grossCents)
        : { fee: 0, net: grossFiatAmount }

      await prisma.donationAccounting.upsert({
        where: { paymentId: pi.id },
        create: {
          source: 'stripe',
          paymentId: pi.id,
          invoiceId: pi.id,
          paymentReceivedAt: new Date(pi.created * 1000),
          cryptoCode: 'USD',
          cryptoAmount: '-',
          rate: '1',
          fiatAmount: grossFiatAmount,
          fiatProcessorFee: fee,
          cryptoProcessorFee: null,
          krakenDeposits: emptyKrakenJson,
          krakenOrders: emptyKrakenJson,
          totalRealizedUsd: netFiatAmount,
          projectSlug: meta.projectSlug,
          projectName: meta.projectName ?? 'General',
          fundSlug: meta.fundSlug as FundSlug,
        },
        update: {
          invoiceId: pi.id,
          paymentReceivedAt: new Date(pi.created * 1000),
          fiatAmount: grossFiatAmount,
          fiatProcessorFee: fee,
          totalRealizedUsd: netFiatAmount,
          projectSlug: meta.projectSlug,
          projectName: meta.projectName ?? 'General',
          fundSlug: meta.fundSlug as FundSlug,
        },
      })
      upserted++
    }
  }

  return { upserted }
}
