import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { env } from './env.mjs'

// `env()` from prisma/config throws if the variable is missing; every CLI command loads this file,
// including `prisma generate` in Docker build where DATABASE_URL is not set.
// Runtime (migrate deploy, app) must set DATABASE_URL — placeholder is only for config load / generate.
const PLACEHOLDER_DATABASE_URL = 'postgresql://magic:magic@magic-postgres:5432/magic?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env.DATABASE_URL || PLACEHOLDER_DATABASE_URL,
  },
})
