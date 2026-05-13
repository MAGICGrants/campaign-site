import { JWT } from 'next-auth/jwt'
import { jwtDecode } from 'jwt-decode'

import { env } from '../../env.mjs'
import { KeycloakJwtPayload } from '../types'
import {
  accountingFundsFromKeycloakGroups,
  siteAdminFromKeycloakGroups,
  type AccountingFundKey,
} from './accounting-access'

export type AccountingTokenClaims = {
  accountingFunds: AccountingFundKey[]
  siteAdmin: boolean
}

export function getAccountingClaimsFromAccessToken(
  accessToken: string | undefined
): AccountingTokenClaims {
  if (!accessToken) {
    return { accountingFunds: [], siteAdmin: false }
  }
  try {
    const payload = jwtDecode<KeycloakJwtPayload>(accessToken)
    const groups = payload.groups
    return {
      accountingFunds: accountingFundsFromKeycloakGroups(groups),
      siteAdmin: siteAdminFromKeycloakGroups(groups),
    }
  } catch {
    return { accountingFunds: [], siteAdmin: false }
  }
}

export async function refreshToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch(
      `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM_NAME}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: env.KEYCLOAK_CLIENT_ID,
          client_secret: env.KEYCLOAK_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken as string,
        }).toString(),
      }
    )

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`)
    }

    const newToken = await response.json()

    const jwtPayload: KeycloakJwtPayload = jwtDecode(newToken.access_token)
    const { accountingFunds, siteAdmin } = getAccountingClaimsFromAccessToken(
      newToken.access_token
    )

    return {
      sub: jwtPayload.sub,
      email: jwtPayload.email,
      accessToken: newToken.access_token,
      accessTokenExpiresAt: Date.now() + (newToken.expires_in as number) * 1000,
      refreshToken: newToken.refresh_token,
      accountingFunds,
      siteAdmin,
    }
  } catch (error) {
    return { ...token, error: 'RefreshAccessTokenError' }
  }
}
