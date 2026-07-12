import { Pool, neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { drizzle as drizzleServerless } from 'drizzle-orm/neon-serverless'

import * as schema from './schema'

export type NeonHttpDb = ReturnType<typeof drizzle>

// The transaction handle the neon-http db hands its callback. Repos are typed
// against `ReturnType<typeof getDb>` (= NeonHttpDb), so this is exactly the
// `tx` type every interactive-transaction call site already uses. Typing
// `runTx` against it keeps those call sites byte-identical (only the function
// name changes) and confines the driver swap to this file.
export type TxHandle = Parameters<Parameters<NeonHttpDb['transaction']>[0]>[0]

let db: NeonHttpDb | undefined
let cachedUrl: string | undefined

// Lazy singleton. Accepts optional URL for CF Workers where process.env
// may not carry secrets at module scope. Caller resolves the URL.
//
// Uses the neon-http (stateless fetch) driver: one HTTP round-trip per query,
// safe to reuse across CF Workers requests. It does NOT support interactive
// transactions (`db.transaction(cb)` throws at runtime) — use `runTx` for those.
// The application runtime connects as the reduced-privilege `kuruma_runtime` role
// (#1553): INSERT/SELECT on the consent ledger, never UPDATE/DELETE. Prefer
// DATABASE_URL_RUNTIME when set; fall back to DATABASE_URL for local/CI/tests and for
// owner-only tools (migrations, seed, break-glass) that read DATABASE_URL directly.
function appDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_RUNTIME ?? process.env.DATABASE_URL
}

export function getDb(url?: string): NeonHttpDb {
  const connectionUrl = url ?? appDatabaseUrl() ?? 'postgresql://placeholder:5432/placeholder'

  // Reuse singleton if URL hasn't changed
  if (db && cachedUrl === connectionUrl) return db

  const client = neon(connectionUrl)
  db = drizzle({ client, schema })
  cachedUrl = connectionUrl
  return db
}

// Run an interactive transaction. The neon-http driver getDb() uses cannot do
// interactive transactions, so this opens a short-lived neon-serverless
// (WebSocket) connection, runs the transaction, and closes it — entirely
// within the caller's request. That per-call lifecycle is the only CF
// Workers-safe pattern: a WebSocket pool cannot be reused across requests
// ("Cannot perform I/O on behalf of a different request"). Reads and non-
// transactional writes stay on the neon-http singleton (#493).
//
// Resolves the URL the same way getDb() does (DATABASE_URL_RUNTIME, then
// DATABASE_URL), so the read handle and this helper can never resolve different
// databases. On CF Workers the global WebSocket is used; under Node the test setup
// sets neonConfig.webSocketConstructor.
//
// DATABASE_URL MUST be the Neon POOLED endpoint (host contains `-pooler`):
// runTx opens a fresh connection per interactive transaction, so a direct
// (unpooled) endpoint would exhaust Postgres backends under load (#493 review).
export async function runTx<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
  const connectionUrl = appDatabaseUrl()
  if (!connectionUrl) {
    throw new Error('runTx requires DATABASE_URL — interactive transactions need a real database')
  }

  const pool = new Pool({ connectionString: connectionUrl })
  try {
    // The serverless tx handle exposes the identical query-builder surface as
    // the neon-http handle the call sites are typed against; the two driver
    // types differ only in their result HKT, so a single cast bridges them.
    const txDb = drizzleServerless({ client: pool, schema }) as unknown as NeonHttpDb
    return await txDb.transaction(fn)
  } finally {
    // Close the per-call connection within this request (Workers-safe). Swallow a
    // teardown error so it can't mask the real transaction error — the booking
    // retry loop keys off the original pg constraint error (#493 review).
    await pool.end().catch(() => {})
  }
}

// The interactive-transaction runner shape. Repos accept one (DIP) so tests and
// the e2e harness can inject a transaction-capable driver (postgres-js) while
// production uses the default runTx (per-call neon-serverless).
export type RunTx = typeof runTx
