// #1205 slice 3 — operator-side unread counter against a real Postgres (issue
// #28 harness). InMemory twin: tests/repositories/operator-unread.test.ts. Proves
// the Drizzle repos do the same SQL-atomic bump on a renter send and the
// scope-branched zero on an operator read. Run via vitest.integration.config.ts
// against the docker pg (DATABASE_URL set, migrated to >= 0090).
import type { RunTx } from '@kuruma/shared/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { DrizzleMessageRepository, DrizzleThreadRepository } from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle'
import {
  cleanupMessaging,
  cleanupOperators,
  createTestOperators,
  createTestUsers,
  testDb,
} from './messaging-setup'

const txDb = testDb as unknown as Db
const runOnTestDb: RunTx = (fn) => txDb.transaction(fn)
const threadRepo = new DrizzleThreadRepository(txDb, runOnTestDb)
const messageRepo = new DrizzleMessageRepository(txDb, runOnTestDb)

const ADMIN: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opCtx = (userId: string, operatorId: string): CallerContext => ({
  userId,
  role: 'OPERATOR_OWNER',
  operatorId,
})
const renterCtx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

const createdUserIds: string[] = []
const createdOperatorIds: string[] = []

let op: string
let renter: string
let staff: string
let threadId: string

const operatorUnread = async (): Promise<number> => {
  const thread = await threadRepo.findById(ADMIN, threadId)
  if (!thread) throw new Error('thread missing')
  return thread.operatorUnreadCount
}

beforeEach(async () => {
  ;[op] = (await createTestOperators(1)) as [string]
  createdOperatorIds.push(op)
  ;[renter, staff] = (await createTestUsers(2)) as [string, string]
  createdUserIds.push(renter, staff)
  threadId = (await threadRepo.create(ADMIN, null, [renter, staff], null, op)).id
})

afterEach(async () => {
  await cleanupMessaging(createdUserIds)
  await cleanupOperators(createdOperatorIds)
  createdUserIds.length = 0
  createdOperatorIds.length = 0
})

describe('operator unread counter (Drizzle / real pg)', () => {
  it('increments on each renter send, not on an operator reply', async () => {
    await messageRepo.create(renterCtx(renter), threadId, 'hi')
    await messageRepo.create(renterCtx(renter), threadId, 'again')
    expect(await operatorUnread()).toBe(2)

    await messageRepo.create(opCtx(staff, op), threadId, 'how can I help?')
    expect(await operatorUnread()).toBe(2)
  })

  it('zeroes when the operator reads, stays put when the renter reads', async () => {
    await messageRepo.create(renterCtx(renter), threadId, 'hi')
    await threadRepo.markAsRead(renterCtx(renter), threadId)
    expect(await operatorUnread()).toBe(1)

    await threadRepo.markAsRead(opCtx(staff, op), threadId)
    expect(await operatorUnread()).toBe(0)
  })

  // #1205 slice 4: create() RETURNING surfaces the post-bump state. This thread has
  // a real operatorId but NO bookingId, so the counter bumps yet the signal is null
  // (the email needs both notNull keys) — proving the drizzle RETURNING + guard
  // against real SQL without a full booking fixture.
  it('returns null operatorUnread for a bookingless thread, though the counter bumps', async () => {
    const { operatorUnread: signal } = await messageRepo.create(renterCtx(renter), threadId, 'hi')
    expect(signal).toBeNull()
    expect(await operatorUnread()).toBe(1)
  })

  it('returns null operatorUnread on an operator reply', async () => {
    await messageRepo.create(renterCtx(renter), threadId, 'hi')
    const { operatorUnread: signal } = await messageRepo.create(
      opCtx(staff, op),
      threadId,
      'how can I help?',
    )
    expect(signal).toBeNull()
  })
})
