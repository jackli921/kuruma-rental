import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { pgConnectOptions } from '../e2e/real-db/pg-connect-options'
import type { getDb } from '../packages/shared/src/db'
import * as schema from '../packages/shared/src/db/schema'
import { seed } from '../packages/shared/src/db/seed'
import { seedBookings } from '../packages/shared/src/db/seed-bookings'

/**
 * Seed a local (or any TCP-reachable) Postgres for the real-DB e2e gate (#445).
 *
 * The shared `seed`/`seedBookings` are injectable (DIP), so we feed them a
 * postgres-js client instead of the production neon-http `getDb()` — neon-http
 * speaks Neon's HTTP protocol and cannot talk to a plain `postgres:16` container.
 * `pgConnectOptions` turns TLS off for localhost. Runs `seed` then `seedBookings`
 * (CLAUDE.md ordering: the fleet must exist before bookings resolve vehicles).
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for db:seed:tcp')

const client = postgres({ ...pgConnectOptions(url), max: 1 })
// The postgres-js handle exposes the same query-builder surface the seeds are
// typed against (neon-http); the drivers differ only in their result HKT, so a
// single cast bridges them — the same seam real-api-server.ts uses.
const db = drizzle(client, { schema }) as unknown as ReturnType<typeof getDb>

try {
  await seed(db)
  await seedBookings(db)
} finally {
  await client.end()
}
