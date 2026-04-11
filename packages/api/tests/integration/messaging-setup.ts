// Cleanup helpers for the messaging integration tests. The actual
// drizzle/postgres-js client lives in `pg-test-client.ts` so it can be
// shared across domain-specific setup files (messaging, vehicles pricing,
// …). See issue #28 and #48.

import { messages, threadParticipants, threads, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { testDb } from './pg-test-client'

export { testDb }

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
