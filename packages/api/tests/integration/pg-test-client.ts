// Shared postgres-js Drizzle client for integration tests.
//
// Production code uses `@neondatabase/serverless` (HTTP) which only speaks
// Neon's HTTPS wire protocol and cannot connect to a local Postgres. For
// tests against the docker `postgres:16` container (CI `db-drift` job or
// local `kuruma-pricing-pg`), we use `postgres-js` — same drizzle-orm
// query API surface but raw Postgres TCP.
//
// Repos in `src/repositories/drizzle.ts` are typed against the neon-http
// return type. The query-builder API is identical across drivers at
// runtime, so tests `as unknown as Db`-cast when constructing repos.
//
// Single client instance per vitest process. Each integration test file
// imports `testDb` from here; all share the same connection pool.

import * as schema from '@kuruma/shared/db/schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const TEST_DATABASE_URL = process.env.DATABASE_URL

if (!TEST_DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests. ' +
      'CI sets this via the postgres service container. Locally, run:\n' +
      '  docker run -d --rm --name kuruma-test-pg \\\n' +
      '    -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma \\\n' +
      '    -e POSTGRES_DB=kuruma_test -p 5432:5432 postgres:16\n' +
      '  DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test bun run db:migrate\n' +
      '  DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test \\\n' +
      '    bun run --filter @kuruma/api test:integration',
  )
}

const client = postgres(TEST_DATABASE_URL, { max: 4 })

export const testDb = drizzle(client, { schema })
