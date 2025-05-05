FROM node:20-alpine3.19 AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY prisma prisma
ENV PRISMA_BINARY_TARGETS='["native", "rhel-openssl-1.0.x"]'

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV SKIP_ENV_VALIDATION 1
ENV NEXT_TELEMETRY_DISABLED 1
ENV PRISMA_BINARY_TARGETS='["native", "rhel-openssl-1.0.x"]'
ENV NEXT_PUBLIC_TURNSTILE_SITEKEY='0x4AAAAAAA11o5rNvbUuAWSJ'
ENV NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT='monerofund@magicgrants.org'
ENV NEXT_PUBLIC_FIRO_APPLICATION_RECIPIENT='firofund@magicgrants.org'
ENV NEXT_PUBLIC_PRIVACY_GUIDES_APPLICATION_RECIPIENT='privacyguidesfund@magicgrants.org'
ENV NEXT_PUBLIC_GENERAL_APPLICATION_RECIPIENT='info@magicgrants.org'
ENV NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX='25aa6f5740f2a885b2605672586845af2a7afd01f4c0c69f59acd0c619c1a5c2'
RUN npx prisma generate

RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

WORKDIR /app

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Install Prisma CLI
RUN mkdir /home/nextjs/.npm-global
ENV PATH=/home/nextjs/.npm-global/bin:$PATH
ENV NPM_CONFIG_PREFIX=/home/nextjs/.npm-global
ENV PRISMA_BINARY_TARGETS='["native", "rhel-openssl-1.0.x"]'
RUN npm install --quiet --no-progress -g prisma
RUN npm cache clean --force

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["/bin/sh", "-c", "prisma migrate deploy && node server.js"]