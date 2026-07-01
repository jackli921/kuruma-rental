// #1205 slice 4 — the operator-unread 0->1 transition signal from create() against
// real Postgres, on a thread backed by a REAL booking (so both notNull email keys
// resolve). InMemory twin: tests/repositories/operator-unread.test.ts. Proves the
// Drizzle UPDATE ... RETURNING returns the post-bump operatorId/bookingId/count, so
// the service can fire OPERATOR_NEW_MESSAGE without a read-then-check race. Run via
// vitest.integration.config.ts against the docker pg (DATABASE_URL set, >= 0091).
import type { RunTx } from '@kuruma/shared/db'
import { threads } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { DrizzleMessageRepository, DrizzleThreadRepository } from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle'
import { type SeededBooking, createSeededBooking } from './booking-factory'
import { testDb } from './messaging-setup'

const txDb = testDb as unknown as Db
const runOnTestDb: RunTx = (fn) => txDb.transaction(fn)
const threadRepo = new DrizzleThreadRepository(txDb, runOnTestDb)
const messageRepo = new DrizzleMessageRepository(txDb, runOnTestDb)

const ADMIN: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const renterCtx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

let seeded: SeededBooking
let threadId: string

beforeEach(async () => {
  seeded = await createSeededBooking({ prefix: 'msg-unread' })
  threadId = (
    await threadRepo.create(ADMIN, seeded.booking.id, [seeded.renterId], null, seeded.operatorId)
  ).id
})

afterEach(async () => {
  // Drop the thread first (cascades participants + messages) so the booking row it
  // references is free, then unwind the booking fixture in FK order.
  await testDb.delete(threads).where(eq(threads.id, threadId))
  await seeded.cleanup()
})

describe('operator-unread transition signal on a real booking thread (Drizzle / real pg)', () => {
  it('returns the post-bump state with both email keys on the first renter send', async () => {
    const { operatorUnread } = await messageRepo.create(renterCtx(seeded.renterId), threadId, 'hi')
    expect(operatorUnread).toEqual({
      operatorId: seeded.operatorId,
      bookingId: seeded.booking.id,
      unreadCount: 1,
    })
  })

  it('returns the running count on the second renter send (no longer the 0->1 window)', async () => {
    await messageRepo.create(renterCtx(seeded.renterId), threadId, 'hi')
    const { operatorUnread } = await messageRepo.create(
      renterCtx(seeded.renterId),
      threadId,
      'again',
    )
    expect(operatorUnread?.unreadCount).toBe(2)
  })
})
