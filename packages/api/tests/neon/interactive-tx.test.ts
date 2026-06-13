import { getDb, runTx } from '@kuruma/shared/db'
import { threadParticipants, threads, users } from '@kuruma/shared/db/schema'
// Real-Neon lane (#493): proves the production driver wiring can run an
// INTERACTIVE transaction end-to-end. The renter booking-submit path opens
// one (POST /bookings -> ensureThread -> DrizzleThreadRepository.create ->
// db.transaction), and the neon-http driver throws "No transactions support"
// at runtime -> 500 on CF Workers. This test exercises that exact write
// through the SAME getDb() wiring production uses (no harness override).
//
// Set NEON_TEST_DATABASE_URL to run it; self-skips otherwise, so it stays out
// of the unit lane and the docker-Postgres integration lane. Two ways to run:
//   - CI (#496): a localhost URL + the local Neon proxy in docker-compose.ci.yml
//     — exercises this exact serverless driver path with ZERO Neon usage.
//   - Real Neon: a NON-PROD branch URL (never production — see
//     reference_neon-branches), driven over secure WebSocket.
import { neonConfig } from '@neondatabase/serverless'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ws from 'ws'
import type { CallerContext } from '../../src/middleware/auth'
import { DrizzleThreadRepository } from '../../src/repositories/drizzle'

const NEON_URL = process.env.NEON_TEST_DATABASE_URL

// Node/vitest has no global WebSocket (verified on Node 20); the serverless
// driver needs one. Production runs on CF Workers where WebSocket is global.
neonConfig.webSocketConstructor = ws

// Local-proxy mode (#496): when NEON_TEST_DATABASE_URL points at localhost, the
// CI stack (docker-compose.ci.yml) fronts a local postgres with a Neon proxy on
// :4444, so this lane exercises the production neon-serverless tx path with ZERO
// Neon usage and no secrets. Any other host = a real Neon branch over secure WS.
// NOTE: the local lane does NOT reproduce prod's pooled-endpoint (`-pooler`)
// requirement — that is an operational guard, not the driver code-path #493
// protects.
if (NEON_URL && new URL(NEON_URL).hostname === 'localhost') {
  const proxyPort = process.env.NEON_PROXY_PORT ?? '4444'
  neonConfig.useSecureWebSocket = false
  neonConfig.wsProxy = (host) => `${host}:${proxyPort}/v2`
  neonConfig.fetchEndpoint = (host) => `http://${host}:${proxyPort}/sql`
}

const ctx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

describe.skipIf(!NEON_URL)('interactive transaction via production wiring (#493)', () => {
  const seededUserIds: string[] = []
  const createdThreadIds: string[] = []

  beforeAll(() => {
    // getDb() and runTx both read process.env.DATABASE_URL — point both at the
    // Neon branch so the read handle and the tx helper can never diverge.
    process.env.DATABASE_URL = NEON_URL
  })

  afterAll(async () => {
    const db = getDb()
    if (createdThreadIds.length > 0) {
      // Cascade from threads removes thread_participants.
      await db.delete(threads).where(inArray(threads.id, createdThreadIds))
    }
    if (seededUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, seededUserIds))
    }
  })

  it('commits a thread + both participants atomically', async () => {
    const db = getDb()
    const seed = crypto.randomUUID()
    const inserted = await db
      .insert(users)
      .values([
        { name: 'TX User A', email: `tx-${seed}-a@example.com` },
        { name: 'TX User B', email: `tx-${seed}-b@example.com` },
      ])
      .returning({ id: users.id })
    const [a, b] = inserted.map((r) => r.id)
    seededUserIds.push(a!, b!)

    // Pre-fix: DrizzleThreadRepository.create -> this.db.transaction(...) on the
    // neon-http driver throws "No transactions support in neon-http driver".
    // Post-fix: it runs through runTx (neon-serverless) and commits.
    const repo = new DrizzleThreadRepository(getDb(), runTx)
    const thread = await repo.create(ctx(a!), null, [a!, b!])
    createdThreadIds.push(thread.id)

    expect(thread.id).toMatch(/[0-9a-f-]{36}/)

    // Prove the write actually committed (not just returned) by re-reading the
    // persisted participant rows through the same wiring.
    const persisted = await getDb()
      .select({ userId: threadParticipants.userId })
      .from(threadParticipants)
      .where(eq(threadParticipants.threadId, thread.id))
    expect(persisted.map((r) => r.userId).sort()).toEqual([a, b].sort())
  })
})
