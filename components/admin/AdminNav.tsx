import Link from 'next/link'
import { useRouter } from 'next/router'

import { cn } from '../../utils/cn'

const LINKS = [
  { href: '/admin/accounting', label: 'Accounting' },
  { href: '/admin/btcpay-payments', label: 'BTCPay Payments' },
  { href: '/admin/kraken-deposits', label: 'Kraken Deposits' },
  { href: '/admin/kraken-sell-orders', label: 'Kraken Sell Orders' },
  { href: '/admin/stripe-invoices', label: 'Stripe Invoices' },
] as const

export default function AdminNav() {
  const router = useRouter()

  return (
    <nav
      className="mb-4 w-full border-b border-border"
      aria-label="Admin sections"
    >
      <ul className="-mb-px flex flex-wrap gap-x-1 gap-y-0.5 sm:gap-x-2">
        {LINKS.map(({ href, label }) => {
          const active = router.pathname === href
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'inline-flex items-center rounded-t-md border-b-2 px-2.5 py-2 text-sm transition-colors sm:px-3',
                  active
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-foreground hover:border-primary/40 hover:text-primary'
                )}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
