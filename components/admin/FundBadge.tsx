import { FundSlug } from '@prisma/client'

import { Badge } from '../ui/badge'
import { cn } from '../../utils/cn'
import { funds } from '../../utils/funds'

/** `outline` variant avoids Badge default `hover:bg-primary/80`. Same color on hover = no shift. */
const fundBadgeClassName: Record<FundSlug, string> = {
  monero: 'border-transparent bg-monero text-white hover:bg-monero',
  firo: 'border-transparent bg-firo text-white hover:bg-firo',
  privacyguides: 'border-transparent bg-privacyguides text-black hover:bg-privacyguides',
  general: 'border-transparent bg-general text-white hover:bg-general',
}

export function FundBadge({ fundSlug }: { fundSlug: string | null | undefined }) {
  if (!fundSlug || fundSlug === '__unknown__') {
    return (
      <Badge variant="secondary" className="font-medium hover:bg-secondary">
        Unknown
      </Badge>
    )
  }

  if (!(fundSlug in funds)) {
    return (
      <Badge variant="outline" className="font-medium hover:bg-transparent">
        {fundSlug}
      </Badge>
    )
  }

  const slug = fundSlug as FundSlug
  const label = funds[slug].title.replace(' Fund', '')

  return (
    <Badge variant="outline" className={cn('font-medium shadow-sm', fundBadgeClassName[slug])}>
      {label}
    </Badge>
  )
}
