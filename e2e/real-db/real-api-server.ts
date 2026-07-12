import type { RunTx } from '@kuruma/shared/db'
import * as schema from '@kuruma/shared/db/schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { buildDrizzleRepos } from '../../packages/api/src/composition/repositories'
import { createApp } from '../../packages/api/src/index'
import type { Db } from '../../packages/api/src/repositories/drizzle'
import { InMemoryPhotoStorage } from '../../packages/api/src/repositories/in-memory/photo-storage'
import { pgConnectOptions } from './pg-connect-options'

// Driver note: production's getDb() uses @neondatabase/serverless (HTTP), whose
// drizzle adapter THROWS on db.transaction() ("No transactions support in
// neon-http driver"). The renter booking submit + slice-7 thread/notification
// dispatch open interactive transactions, so a plain createApp() (repos off
// getDb()) 500s on POST /bookings. The integration suite hits the same wall and
// resolves it identically: a postgres-js client (real Postgres TCP, transaction-
// capable) injected via createApp overrides. We mirror that so the E2E exercises
// the real service/repo logic + real data over real HTTP. (#493 has since fixed
// the production gap — interactive transactions run via runTx/neon-serverless —
// but we still inject a postgres-js runner here so the e2e stays on TCP Postgres.)
const port = Number(process.env.REAL_API_PORT ?? 8788)

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for the real-DB e2e API server')

// Build from URL parts (see pg-connect-options) so libpq-only params never reach
// postgres-js and TLS is off for a localhost container; prepare:false keeps
// interactive transactions safe over the Neon transaction-mode pooler.
const client = postgres({ ...pgConnectOptions(url), prepare: false, max: 5 })
const db = drizzle(client, { schema }) as unknown as Db

// #493: thread/message create take an injected interactive-tx runner (DIP).
// Back it with this postgres-js client so the e2e stays on TCP Postgres instead
// of the production default (per-call neon-serverless runTx).
const runOnTestDb: RunTx = (fn) => db.transaction(fn)

// Reuse the production composition root (buildDrizzleRepos) instead of hand-
// listing every repo. The old hand-mirror silently omitted addOnRepo, so the
// operator add-ons page rendered empty under e2e while every other page read the
// seeded DB (#634) — and each new Drizzle repo had to be added here or the e2e
// would lie. Injecting our postgres-js db + interactive-tx runner keeps the e2e
// on TCP Postgres (production's neon-http getDb() throws on db.transaction())
// while every repo, booking_events, and the atomic booking submit stay Drizzle-
// backed against the real test database.
// #1538: buildDrizzleRepos wires DisabledPhotoStorage when no R2 bucket is bound — correct
// for production CF Workers (a per-request InMemory instance would "succeed" then serve URLs
// pointing at nothing), but it makes the vehicle-photo upload/delete path throw locally. This
// harness is a SINGLE long-lived Bun process, so one InMemoryPhotoStorage persists across
// requests and the upload -> visible -> delete -> gone flow round-trips for real. Swapped in
// exactly like the postgres-js db/runTx above; inert for every spec that doesn't touch photos.
const repos = {
  ...buildDrizzleRepos({ db, runTx: runOnTestDb }),
  photoStorage: new InMemoryPhotoStorage(),
}
const app = createApp(undefined, repos)

Bun.serve({ port, fetch: app.fetch })
console.log(`[e2e] real API listening on http://localhost:${port}`)
