import { FundSlug, PrismaClient } from '@prisma/client'
import Stripe from 'stripe'
import KeycloakAdminClient from '@keycloak/keycloak-admin-client'
import nodemailer from 'nodemailer'
import axios, { isAxiosError } from 'axios'

import { env } from '../env.mjs'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const keycloak = new KeycloakAdminClient({
  baseUrl: env.KEYCLOAK_URL,
  realmName: env.KEYCLOAK_REALM_NAME,
})

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT),
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
})

const btcpayApi = axios.create({
  baseURL: `${env.BTCPAY_URL}/api/v1/stores/${env.BTCPAY_STORE_ID}`,
  headers: { Authorization: `token ${env.BTCPAY_API_KEY}` },
})

const strapiApi = axios.create({
  baseURL: `${env.STRAPI_API_URL}`,
  headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
})

const printfulApi = axios.create({
  baseURL: 'https://api.printful.com',
  headers: { Authorization: `Bearer ${env.PRINTFUL_API_KEY}` },
})

const stripe: Record<FundSlug, Stripe> = {
  monero: new Stripe(env.STRIPE_MONERO_SECRET_KEY, { apiVersion: '2026-02-25.clover' }),
  firo: new Stripe(env.STRIPE_FIRO_SECRET_KEY, { apiVersion: '2026-02-25.clover' }),
  privacyguides: new Stripe(env.STRIPE_PRIVACY_GUIDES_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  }),
  general: new Stripe(env.STRIPE_GENERAL_SECRET_KEY, { apiVersion: '2026-02-25.clover' }),
}

const privacyGuidesDiscourseApi = axios.create({
  baseURL: `${env.PRIVACYGUIDES_DISCOURSE_URL}`,
  headers: {
    'api-key': env.PRIVACYGUIDES_DISCOURSE_API_KEY,
    'api-username': env.PRIVACYGUIDES_DISCOURSE_API_USERNAME,
  },
})

function toCoinbaseCdpError(error: unknown): Error {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const { response, message } = error
  if (response) {
    const body =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data)
    const err = new Error(`HTTP ${response.status}: ${body}`)
    ;(err as Error & { status?: number }).status = response.status
    return err
  }
  return new Error(message || 'Coinbase CDP request failed')
}

/** Coinbase CDP Business API — use full paths on requests (see `coinbase-cdp.ts`). */
const coinbaseCdpApi = axios.create({
  baseURL: 'https://business.coinbase.com',
})

coinbaseCdpApi.interceptors.response.use(
  (res) => res,
  (error) => Promise.reject(toCoinbaseCdpError(error))
)

const geminiApi = axios.create({
  baseURL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
})

export {
  prisma,
  keycloak,
  transporter,
  btcpayApi,
  strapiApi,
  printfulApi,
  stripe,
  privacyGuidesDiscourseApi,
  coinbaseCdpApi,
  geminiApi,
}
