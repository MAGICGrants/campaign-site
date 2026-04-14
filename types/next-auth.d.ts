import NextAuth from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      sub: string
      email: string
      accountingFunds: ('monero' | 'firo' | 'privacyguides' | 'general' | 'unknown')[]
      canAccessAccounting: boolean
    }
  }
}
