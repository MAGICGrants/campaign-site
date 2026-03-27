FROM node:24-alpine3.22 AS base

# Install dependencies only when needed
FROM base AS deps

WORKDIR /app

# Transient registry errors (e.g. 409 Conflict on a tarball GET) are common; retries help.
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

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

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_BINARY_TARGETS='["native", "rhel-openssl-1.0.x"]'
ENV NEXT_PUBLIC_TURNSTILE_SITEKEY='0x4AAAAAAA11o5rNvbUuAWSJ'
ENV NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT='monerofund@magicgrants.org'
ENV NEXT_PUBLIC_FIRO_APPLICATION_RECIPIENT='firofund@magicgrants.org'
ENV NEXT_PUBLIC_PRIVACY_GUIDES_APPLICATION_RECIPIENT='privacyguidesfund@magicgrants.org'
ENV NEXT_PUBLIC_GENERAL_APPLICATION_RECIPIENT='info@magicgrants.org'
ENV NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX='25aa6f5740f2a885b2605672586845af2a7afd01f4c0c69f59acd0c619c1a5c2'
RUN npx prisma generate
RUN npx tsc

RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/out ./out
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /tmp/prisma-for-migrate && cd /tmp/prisma-for-migrate \
  && npm init -y \
  && npm install prisma@6.19.2 --omit=dev \
  && cp -r /tmp/prisma-for-migrate/node_modules/. /app/node_modules/ \
  && rm -rf /tmp/prisma-for-migrate \
  && chown -R nextjs:nodejs /app/node_modules

USER nextjs

WORKDIR /app
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install Prisma CLI
RUN mkdir /home/nextjs/.npm-global
ENV PATH=/home/nextjs/.npm-global/bin:$PATH
ENV NPM_CONFIG_PREFIX=/home/nextjs/.npm-global
ENV PRISMA_BINARY_TARGETS='["native", "rhel-openssl-1.0.x"]'
RUN npm cache clean --force

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["/bin/sh", "-c", "npx prisma migrate deploy \
&& (npm run sentry:sourcemaps \
& node server.js)"]