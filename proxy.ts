import { withAuth } from 'next-auth/middleware'
import { refreshToken } from './server/utils/auth'

export default withAuth({
  pages: {
    signIn: '/',
  },
  callbacks: {
    async authorized({ token, req }) {
      const isAdminRoute = req.nextUrl.pathname.startsWith('/admin')

      if (!token) return false

      if (Date.now() >= token.accessTokenExpiresAt || token.error) {
        const newToken = await refreshToken(token)
        if (Date.now() >= newToken.accessTokenExpiresAt || newToken.error) {
          return false
        }
        if (isAdminRoute && !(newToken.accountingFunds && newToken.accountingFunds.length > 0)) {
          return false
        }
        return true
      }

      if (isAdminRoute && !(token.accountingFunds && token.accountingFunds.length > 0)) return false

      return true
    },
  },
})

export const config = { matcher: ['/:path/account/:path*', '/admin/:path*'] }
