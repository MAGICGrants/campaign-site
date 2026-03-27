import { defineConfig } from 'prisma/config'

// `env()` from prisma/config throws if the variable is missing; every CLI command loads this file,
// including `prisma generate` in Docker build where DATABASE_URL is not set.
// Runtime (migrate deploy, app) must set DATABASE_URL — placeholder is only for config load / generate.
const PLACEHOLDER_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL?.trim() || PLACEHOLDER_DATABASE_URL,
  },
})
