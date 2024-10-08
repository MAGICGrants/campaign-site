import axios from 'axios'
import { JWT } from 'next-auth/jwt'
import { jwtDecode } from 'jwt-decode'

import { env } from '../../env.mjs'
import { KeycloakJwtPayload } from '../types'

export async function refreshToken(token: JWT): Promise<JWT> {
  try {
    const { data: newToken } = await axios.post(
      `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM_NAME}/protocol/openid-connect/token`,
      new URLSearchParams({
        client_id: env.KEYCLOAK_CLIENT_ID,
        client_secret: env.KEYCLOAK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken as string,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const jwtPayload: KeycloakJwtPayload = jwtDecode(newToken.access_token)

    return {
      sub: jwtPayload.sub,
      email: jwtPayload.email,
      accessToken: newToken.access_token,
      accessTokenExpiresAt: Date.now() + (newToken.expires_in as number) * 1000,
      refreshToken: newToken.refresh_token,
    }
  } catch (error) {
    return { ...token, error: 'RefreshAccessTokenError' }
  }
}
