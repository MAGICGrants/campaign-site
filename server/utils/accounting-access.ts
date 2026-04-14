import { TRPCError } from '@trpc/server'
import type { FundSlug, Prisma } from '@prisma/client'

/** Matches Keycloak group paths for fund-scoped accounting viewers. */
export const KEYCLOAK_ACCOUNTING_GROUP: Record<FundSlug | 'unknown', string> = {
  general: '/general-accounting',
  monero: '/monero-accounting',
  privacyguides: '/privacyguides-accounting',
  firo: '/firo-accounting',
  unknown: '/unknown-accounting',
}

export const ALL_KEYCLOAK_ACCOUNTING_GROUPS = Object.values(KEYCLOAK_ACCOUNTING_GROUP)

export type AccountingFundKey = FundSlug | 'unknown'

export type AccountingFundAccess = {
  funds: FundSlug[]
  unknown: boolean
}

export function accountingFundsFromKeycloakGroups(groups: string[] | undefined): AccountingFundKey[] {
  const set = new Set(groups ?? [])
  const out: AccountingFundKey[] = []
  for (const slug of ['monero', 'firo', 'privacyguides', 'general'] as FundSlug[]) {
    if (set.has(KEYCLOAK_ACCOUNTING_GROUP[slug])) {
      out.push(slug)
    }
  }
  if (set.has(KEYCLOAK_ACCOUNTING_GROUP.unknown)) {
    out.push('unknown')
  }
  return out
}

export function toFundAccess(keys: AccountingFundKey[]): AccountingFundAccess {
  return {
    funds: keys.filter((k): k is FundSlug => k !== 'unknown'),
    unknown: keys.includes('unknown'),
  }
}

export function getAccountingAccess(user: {
  accountingFunds?: AccountingFundKey[]
}): AccountingFundAccess {
  return toFundAccess(user.accountingFunds ?? [])
}

export function hasAnyAccountingAccess(access: AccountingFundAccess): boolean {
  return access.funds.length > 0 || access.unknown
}

/** Validate requested fund filter against JWT-derived access. */
export function assertFundSlugAllowed(
  access: AccountingFundAccess,
  fundSlug: string | undefined
): void {
  if (fundSlug === undefined || fundSlug === '__all__') return
  if (fundSlug === '__unknown__') {
    if (!access.unknown) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'No access to unknown fund data',
      })
    }
    return
  }
  const slug = fundSlug as FundSlug
  if (!access.funds.includes(slug)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this fund' })
  }
}

/**
 * When the user does not pick a single fund: restrict `DonationAccounting` rows to allowed funds.
 * `fundSlug` null (unknown) is an `OR` branch because Prisma enum `in` cannot include null.
 */
export function prismaDonationAccountingFundCondition(
  access: AccountingFundAccess
): Prisma.DonationAccountingWhereInput {
  if (access.funds.length > 0 && access.unknown) {
    return {
      OR: [{ fundSlug: { in: access.funds } }, { fundSlug: null }],
    }
  }
  if (access.funds.length > 0) {
    return { fundSlug: { in: access.funds } }
  }
  if (access.unknown) {
    return { fundSlug: null }
  }
  return { fundSlug: { in: [] } }
}

export function stripeFundSlugsForQuery(
  access: AccountingFundAccess,
  inputFundSlug: string | undefined
): FundSlug[] {
  assertFundSlugAllowed(access, inputFundSlug)
  if (inputFundSlug && inputFundSlug !== '__all__' && inputFundSlug !== '__unknown__') {
    return [inputFundSlug as FundSlug]
  }
  if (inputFundSlug === '__unknown__') {
    return []
  }
  return access.funds
}

export function btcpayFundAllowed(
  access: AccountingFundAccess,
  fundSlug: string | undefined | null
): boolean {
  if (fundSlug == null || fundSlug === '') return access.unknown
  return access.funds.includes(fundSlug as FundSlug)
}
