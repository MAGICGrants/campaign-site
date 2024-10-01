import { z } from 'zod'
import { jwtDecode } from 'jwt-decode'
import { TRPCError } from '@trpc/server'
import axios from 'axios'

import { protectedProcedure, router } from '../trpc'
import { env } from '../../env.mjs'
import { KeycloakJwtPayload } from '../types'
import { keycloak } from '../services'
import { authenticateKeycloakClient } from '../utils/keycloak'

export const accountRouter = router({
  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.sub
      const email = ctx.session.user.email
      let accessToken = ''

      try {
        const { data: token } = await axios.post(
          `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM_NAME}/protocol/openid-connect/token`,
          new URLSearchParams({
            grant_type: 'password',
            client_id: env.KEYCLOAK_CLIENT_ID,
            client_secret: env.KEYCLOAK_CLIENT_SECRET,
            username: ctx.session.user.email,
            password: input.currentPassword,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )

        accessToken = token.access_token
      } catch (error) {
        const errorMessage = (error as any).response.data.error

        if (errorMessage === 'invalid_grant') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_PASSWORD' })
        }

        throw error
      }

      const keycloakJwtPayload: KeycloakJwtPayload = jwtDecode(accessToken)

      if (keycloakJwtPayload.sub !== userId || keycloakJwtPayload.email !== email) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      await authenticateKeycloakClient()

      await keycloak.users.update(
        { id: userId },
        {
          email,
          credentials: [{ type: 'password', value: input.newPassword, temporary: false }],
        }
      )
    }),
})
