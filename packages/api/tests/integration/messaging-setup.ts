// Standalone Postgres test client for the messaging integration tests.
//
// The production code in `packages/shared/src/db/index.ts` uses
// `@neondatabase/serverless` (HTTP). That driver only speaks Neon's HTTPS
// wire protocol and cannot connect to a vanilla Postgres on localhost, so
// it is unusable for tests against the docker `postgres:16` container that
// CI's `db-drift` job spins up. We use `postgres-js` here instead — same
// `drizzle-orm` query API surface as neon-http, but speaks raw Postgres TCP.
//
// The repo classes in `src/repositories/drizzle.ts` are typed against the
// neon-http return type. At runtime drizzle's select/insert/update/delete
// API is identical across drivers, so we cast the postgres-js drizzle
// instance to the same type when constructing the repos under test.
//
// Existing integration tests under `tests/integration/` (vehicles, bookings,
// availability) still go through `getDb()` and remain unrunnable until
// issue #29 migrates them to the same pattern. Out of scope for #28.

import * as schema from '@kuruma/shared/db/schema'
import { messages, threadParticipants, threads, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const TEST_DATABASE_URL = process.env.DATABASE_URL

if (!TEST_DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests. ' +
      'CI sets this via the postgres service container; locally run ' +
      '`docker run -d --rm --name kuruma-test-pg -e POSTGRES_USER=kuruma ' +
      '-e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_test -p 5432:5432 postgres:16` ' +
      'and `DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test bun run db:migrate` first.',
  )
}

// Single client per process; vitest reuses the module across files.
const client = postgres(TEST_DATABASE_URL, { max: 4 })

export const testDb = drizzle(client, { schema })

/**
 * Create real users for FK satisfaction. `thread_participants.userId` and
 * `messages.senderId` both have FKs into `users`. Returns ids in insert
 * order so callers can pin participantIds in tests.
 */
export async function createTestUsers(count: number): Promise<string[]> {
  const seed = crypto.randomUUID()
  const rows = Array.from({ length: count }, (_, i) => ({
    name: `Test User ${i}`,
    email: `test-${seed}-${i}@example.com`,
  }))
  const inserted = await testDb.insert(users).values(rows).returning({ id: users.id })
  return inserted.map((r) => r.id)
}

/**
 * Tear down the messaging tables for the given user ids. Cascades from
 * `threads` clean up `thread_participants` and `messages`.
 */
export async function cleanupMessaging(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return

  // Delete threads where any participant is one of our test users.
  // We don't have a direct query helper, so do it in two passes:
  // 1. Find threadIds touched by these users via participants.
  // 2. Delete the threads (cascade removes participants + messages).
  const participantRows = await testDb
    .select({ threadId: threadParticipants.threadId })
    .from(threadParticipants)
    .where(inArray(threadParticipants.userId, userIds))

  const threadIds = [...new Set(participantRows.map((r) => r.threadId))]
  if (threadIds.length > 0) {
    await testDb.delete(threads).where(inArray(threads.id, threadIds))
  }

  // Also clear any messages directly authored by these users that somehow
  // escaped (e.g. orphan inserts in failing tests).
  await testDb.delete(messages).where(inArray(messages.senderId, userIds))

  // Finally drop the users themselves.
  await testDb.delete(users).where(inArray(users.id, userIds))
}
