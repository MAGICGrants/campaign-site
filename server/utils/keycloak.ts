import { env } from '../../env.mjs'

/** Dynamic import avoids loading `server/services` (Stripe, etc.) during `next build` for pages that only import this helper. */
export async function authenticateKeycloakClient() {
  const { keycloak } = await import('../services')
  return keycloak.auth({
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
    grantType: 'client_credentials',
  })
}
