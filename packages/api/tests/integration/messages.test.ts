// Integration tests for DrizzleThreadRepository + DrizzleMessageRepository
// against a real Postgres (issue #28).
//
// Run locally:
//   docker run -d --rm --name kuruma-test-pg \
//     -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_test \
//     -p 5432:5432 postgres:16
//   DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test bun run db:migrate
//   cd packages/api && bunx vitest run --config vitest.integration.config.ts
//
// CI runs the same flow in the `db-drift` job (see .github/workflows/ci.yml).

import type { RunTx } from '@kuruma/shared/db'
import { sql } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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

// thread/message create open interactive transactions; inject a postgres-js
// runner so they use the test DB over TCP instead of the default neon-serverless
// runTx, which can't reach a local/docker Postgres (#493).
const txDb = testDb as unknown as Db
const runOnTestDb: RunTx = (fn) => txDb.transaction(fn)
const threadRepo = new DrizzleThreadRepository(txDb, runOnTestDb)
const messageRepo = new DrizzleMessageRepository(txDb, runOnTestDb)

const ctx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

const createdUserIds: string[] = []
const createdOperatorIds: string[] = []

afterEach(async () => {
  // Order matters: threads reference operators via an ON DELETE restrict FK, so
  // clear the messaging rows (which drop the threads) before the operators.
  await cleanupMessaging(createdUserIds)
  await cleanupOperators(createdOperatorIds)
  createdUserIds.length = 0
  createdOperatorIds.length = 0
})

describe('DrizzleThreadRepository', () => {
  describe('create', () => {
    it('creates a thread with two participants and returns it', async () => {
      const [u1, u2] = await createTestUsers(2)
      createdUserIds.push(u1!, u2!)

      const thread = await threadRepo.create(ctx(u1!), null, [u1!, u2!])

      expect(thread.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(thread.bookingId).toBeNull()
      expect(thread.createdAt).toBeInstanceOf(Date)
      expect(thread.updatedAt).toBeInstanceOf(Date)
    })

    it('persists participants with unreadCount=0', async () => {
      const [u1, u2] = await createTestUsers(2)
      createdUserIds.push(u1!, u2!)

      const thread = await threadRepo.create(ctx(u1!), null, [u1!, u2!])
      const fetched = await threadRepo.findById(ctx(u1!), thread.id)

      expect(fetched).toBeDefined()
      expect(fetched!.participants).toHaveLength(2)
      const participantUserIds = fetched!.participants.map((p) => p.userId).sort()
      expect(participantUserIds).toEqual([u1, u2].sort())
      for (const p of fetched!.participants) {
        expect(p.unreadCount).toBe(0)
      }
    })

    it('supports a null bookingId (standalone thread)', async () => {
      const [u1, u2] = await createTestUsers(2)
      createdUserIds.push(u1!, u2!)

      const thread = await threadRepo.create(ctx(u1!), null, [u1!, u2!])

      expect(thread.bookingId).toBeNull()
    })
  })

  describe('findAll', () => {
    it('returns only threads the user participates in', async () => {
      const [alice, bob, carol] = await createTestUsers(3)
      createdUserIds.push(alice!, bob!, carol!)

      // Thread 1: alice + bob
      await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      // Thread 2: bob + carol (alice is NOT a participant)
      await threadRepo.create(ctx(bob!), null, [bob!, carol!])

      const aliceThreads = await threadRepo.findAll(ctx(alice!))
      const bobThreads = await threadRepo.findAll(ctx(bob!))
      const carolThreads = await threadRepo.findAll(ctx(carol!))

      expect(aliceThreads).toHaveLength(1)
      expect(bobThreads).toHaveLength(2)
      expect(carolThreads).toHaveLength(1)
    })

    it('includes participants and the most recent message per thread', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      await messageRepo.create(ctx(alice!), thread.id, 'first')
      await new Promise((r) => setTimeout(r, 5)) // ensure ordering
      await messageRepo.create(ctx(bob!), thread.id, 'second')

      const threads = await threadRepo.findAll(ctx(alice!))
      expect(threads).toHaveLength(1)
      const t = threads[0]!
      expect(t.participants).toHaveLength(2)
      expect(t.lastMessage).not.toBeNull()
      expect(t.lastMessage!.content).toBe('second')
    })

    it('returns empty array when user has no threads', async () => {
      const [loner] = await createTestUsers(1)
      createdUserIds.push(loner!)

      const result = await threadRepo.findAll(ctx(loner!))
      expect(result).toEqual([])
    })
  })

  describe('findById', () => {
    it('returns thread with participants and ordered messages', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      await messageRepo.create(ctx(alice!), thread.id, 'one')
      await new Promise((r) => setTimeout(r, 5))
      await messageRepo.create(ctx(bob!), thread.id, 'two')
      await new Promise((r) => setTimeout(r, 5))
      await messageRepo.create(ctx(alice!), thread.id, 'three')

      const found = await threadRepo.findById(ctx(alice!), thread.id)

      expect(found).toBeDefined()
      expect(found!.id).toBe(thread.id)
      expect(found!.participants).toHaveLength(2)
      expect(found!.messages).toHaveLength(3)
      expect(found!.messages.map((m) => m.content)).toEqual(['one', 'two', 'three'])
    })

    it('returns undefined for nonexistent thread id', async () => {
      const [requester] = await createTestUsers(1)
      createdUserIds.push(requester!)
      const found = await threadRepo.findById(
        ctx(requester!),
        '00000000-0000-0000-0000-000000000000',
      )
      expect(found).toBeUndefined()
    })
  })

  describe('markAsRead', () => {
    it('zeroes the unread count for the given user only', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      // Alice sends two messages → bob's unreadCount becomes 2
      await messageRepo.create(ctx(alice!), thread.id, 'hi')
      await messageRepo.create(ctx(alice!), thread.id, 'you there?')

      const beforeBob = await threadRepo.findAll(ctx(bob!))
      const bobBefore = beforeBob[0]!.participants.find((p) => p.userId === bob)!
      expect(bobBefore.unreadCount).toBe(2)

      await threadRepo.markAsRead(ctx(bob!), thread.id)

      const afterBob = await threadRepo.findAll(ctx(bob!))
      const bobAfter = afterBob[0]!.participants.find((p) => p.userId === bob)!
      const aliceAfter = afterBob[0]!.participants.find((p) => p.userId === alice)!
      expect(bobAfter.unreadCount).toBe(0)
      // Alice's count must NOT have been touched.
      expect(aliceAfter.unreadCount).toBe(0)
    })

    it('is a no-op for a user who is not a participant', async () => {
      const [alice, bob, eve] = await createTestUsers(3)
      createdUserIds.push(alice!, bob!, eve!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      await messageRepo.create(ctx(alice!), thread.id, 'hi')

      // eve is not in the thread; should not throw, should not affect anything.
      await expect(threadRepo.markAsRead(ctx(eve!), thread.id)).resolves.toBeUndefined()

      const after = await threadRepo.findAll(ctx(bob!))
      const bobAfter = after[0]!.participants.find((p) => p.userId === bob)!
      expect(bobAfter.unreadCount).toBe(1)
    })
  })
})

describe('DrizzleMessageRepository', () => {
  describe('create', () => {
    it('inserts a message and returns it with generated fields', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      const { message } = await messageRepo.create(ctx(alice!), thread.id, 'hello world')

      expect(message.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(message.threadId).toBe(thread.id)
      expect(message.senderId).toBe(alice)
      expect(message.content).toBe('hello world')
      expect(message.sourceLanguage).toBeNull()
      expect(message.translations).toEqual({})
      expect(message.createdAt).toBeInstanceOf(Date)
    })

    it('rejects a non-JSON write to the jsonb translations column at the DB', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      const { message } = await messageRepo.create(ctx(alice!), thread.id, 'hello')

      // The legacy text column silently accepted invalid JSON (every later read
      // then threw on the ::jsonb cast). The jsonb column rejects it at the write
      // boundary instead — #729. drizzle wraps the driver error, so the postgres-js
      // reason (SQLSTATE 22P02) lives on `.cause`.
      const error = (await txDb
        .execute(sql`UPDATE messages SET translations = '{not valid json' WHERE id = ${message.id}`)
        .then(() => null)
        .catch((e: unknown) => e)) as (Error & { cause?: unknown }) | null

      expect(error).not.toBeNull()
      // Assert the SQLSTATE, not the English message text (locale-dependent):
      // 22P02 = invalid_text_representation, i.e. the jsonb column rejected the write.
      expect((error?.cause as { code?: string })?.code).toBe('22P02')
    })

    it('atomically increments unreadCount for every participant except the sender', async () => {
      // Regression for the Check-Then-Act race anti-pattern called out in the
      // issue. The repo must use a single arithmetic UPDATE on the participants
      // row, not a read-modify-write that races with concurrent inserts.
      const [alice, bob, carol] = await createTestUsers(3)
      createdUserIds.push(alice!, bob!, carol!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!, carol!])

      // Alice sends 5 messages serially.
      for (let i = 0; i < 5; i++) {
        await messageRepo.create(ctx(alice!), thread.id, `msg ${i}`)
      }

      const found = await threadRepo.findById(ctx(alice!), thread.id)
      const aliceP = found!.participants.find((p) => p.userId === alice)!
      const bobP = found!.participants.find((p) => p.userId === bob)!
      const carolP = found!.participants.find((p) => p.userId === carol)!

      // Sender's count must not move.
      expect(aliceP.unreadCount).toBe(0)
      // Every other participant gains exactly one per message.
      expect(bobP.unreadCount).toBe(5)
      expect(carolP.unreadCount).toBe(5)
    })

    it('handles concurrent message inserts without losing any unread increments', async () => {
      // Stronger race-condition test. With a read-modify-write, parallel
      // inserts would interleave their reads and clobber each other's writes,
      // leaving the final unreadCount lower than the message count. With an
      // atomic SQL `unreadCount = unreadCount + 1`, the final count must
      // equal the number of messages sent by other users.
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])

      const N = 10
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          messageRepo.create(ctx(alice!), thread.id, `parallel ${i}`),
        ),
      )

      const found = await threadRepo.findById(ctx(alice!), thread.id)
      const bobP = found!.participants.find((p) => p.userId === bob)!
      expect(bobP.unreadCount).toBe(N)
      expect(found!.messages).toHaveLength(N)
    })
  })

  describe('findByThreadId', () => {
    it('returns messages in chronological order', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      await messageRepo.create(ctx(alice!), thread.id, 'first')
      await new Promise((r) => setTimeout(r, 5))
      await messageRepo.create(ctx(bob!), thread.id, 'second')
      await new Promise((r) => setTimeout(r, 5))
      await messageRepo.create(ctx(alice!), thread.id, 'third')

      const messages = await messageRepo.findByThreadId(ctx(alice!), thread.id)
      expect(messages.map((m) => m.content)).toEqual(['first', 'second', 'third'])
    })

    it('returns empty array for thread with no messages', async () => {
      const [alice, bob] = await createTestUsers(2)
      createdUserIds.push(alice!, bob!)

      const thread = await threadRepo.create(ctx(alice!), null, [alice!, bob!])
      const messages = await messageRepo.findByThreadId(ctx(alice!), thread.id)
      expect(messages).toEqual([])
    })
  })
})

describe('persistence across repo instances (the whole point of #28)', () => {
  it('messages survive when a fresh repo is constructed against the same DB', async () => {
    const [alice, bob] = await createTestUsers(2)
    createdUserIds.push(alice!, bob!)

    const repoA = new DrizzleThreadRepository(txDb, runOnTestDb)
    const messageRepoA = new DrizzleMessageRepository(txDb, runOnTestDb)

    const thread = await repoA.create(ctx(alice!), null, [alice!, bob!])
    await messageRepoA.create(ctx(alice!), thread.id, 'before restart')

    // Simulate Worker cold-start: throw away the repo handles, build new ones.
    const repoB = new DrizzleThreadRepository(txDb, runOnTestDb)

    const found = await repoB.findById(ctx(alice!), thread.id)
    expect(found).toBeDefined()
    expect(found!.messages).toHaveLength(1)
    expect(found!.messages[0]!.content).toBe('before restart')
  })
})

// Operator tenant isolation against real Postgres (#1205). The Drizzle read scope
// `threads.operatorId = ctx.operatorId` IS the cross-tenant renter-PII boundary, but
// before this block it had ZERO real-pg coverage — every other ctx here is a RENTER,
// so deleting the operator filter from the Drizzle repos would have shipped green.
// An operator reads by TENANT, not participant membership, so the operator caller
// needs no users row: its userId never reaches a FK on these read/markAsRead paths.
describe('operator tenant isolation (#1205, real-pg)', () => {
  const opCtx = (operatorId: string): CallerContext => ({
    userId: `op-caller-${operatorId}`,
    role: 'OPERATOR_OWNER',
    operatorId,
  })

  // Seed a booking-less thread owned by `operatorId` with a renter participant and
  // one renter message (the renter send bumps the tenant-level unread 0 -> 1).
  async function seedOperatorThread(operatorId: string) {
    const [renter, staff] = await createTestUsers(2)
    createdUserIds.push(renter!, staff!)
    const thread = await threadRepo.create(ctx(renter!), null, [renter!, staff!], null, operatorId)
    const { message } = await messageRepo.create(ctx(renter!), thread.id, 'renter question')
    return { threadId: thread.id, messageId: message.id }
  }

  it("cannot read another operator's thread (findAll / findById / findByThreadId)", async () => {
    const [opA, opB] = await createTestOperators(2)
    createdOperatorIds.push(opA!, opB!)
    const b = await seedOperatorThread(opB!)

    // findAll: A sees none of B's threads; B sees exactly its own.
    expect(await threadRepo.findAll(opCtx(opA!))).toEqual([])
    expect((await threadRepo.findAll(opCtx(opB!))).map((t) => t.id)).toEqual([b.threadId])

    // findById: A gets undefined; B gets the thread.
    expect(await threadRepo.findById(opCtx(opA!), b.threadId)).toBeUndefined()
    expect((await threadRepo.findById(opCtx(opB!), b.threadId))?.id).toBe(b.threadId)

    // findByThreadId (message listing): A gets []; B gets the message.
    expect(await messageRepo.findByThreadId(opCtx(opA!), b.threadId)).toEqual([])
    expect(
      (await messageRepo.findByThreadId(opCtx(opB!), b.threadId)).map((m) => m.content),
    ).toEqual(['renter question'])
  })

  it("cannot resolve another operator's message by id", async () => {
    const [opA, opB] = await createTestOperators(2)
    createdOperatorIds.push(opA!, opB!)
    const b = await seedOperatorThread(opB!)

    expect(await messageRepo.findById(opCtx(opA!), b.messageId)).toBeUndefined()
    expect((await messageRepo.findById(opCtx(opB!), b.messageId))?.id).toBe(b.messageId)
  })

  it("cannot reply in another operator's thread — the route's findById 404 gate returns undefined", async () => {
    // POST /threads/:id/messages runs getThread -> threadRepo.findById first and
    // 404s before createMessage. So findById being undefined for operator A on
    // operator B's thread IS the real-pg proof that A cannot reply in it (the repo
    // create itself trusts the pre-checked threadId — the gate lives in the read).
    const [opA, opB] = await createTestOperators(2)
    createdOperatorIds.push(opA!, opB!)
    const b = await seedOperatorThread(opB!)

    expect(await threadRepo.findById(opCtx(opA!), b.threadId)).toBeUndefined()
  })

  it("markAsRead cannot clear another operator's tenant unread", async () => {
    const [opA, opB] = await createTestOperators(2)
    createdOperatorIds.push(opA!, opB!)
    const b = await seedOperatorThread(opB!)

    // The renter send set B's tenant-level unread to 1.
    expect((await threadRepo.findById(opCtx(opB!), b.threadId))?.operatorUnreadCount).toBe(1)

    // Operator A's markAsRead is a scoped no-op: its WHERE operatorId = A misses B's thread.
    await threadRepo.markAsRead(opCtx(opA!), b.threadId)
    expect((await threadRepo.findById(opCtx(opB!), b.threadId))?.operatorUnreadCount).toBe(1)

    // Positive control: B clears its own tenant unread to 0.
    await threadRepo.markAsRead(opCtx(opB!), b.threadId)
    expect((await threadRepo.findById(opCtx(opB!), b.threadId))?.operatorUnreadCount).toBe(0)
  })

  it('an operator missing its operatorId is fail-closed — reads nothing', async () => {
    const [opB] = await createTestOperators(1)
    createdOperatorIds.push(opB!)
    const b = await seedOperatorThread(opB!)

    // No operatorId => threadReadScope returns { kind: 'none' } => every read is empty.
    const noneCtx: CallerContext = { userId: 'unscoped-operator', role: 'OPERATOR_OWNER' }

    expect(await threadRepo.findAll(noneCtx)).toEqual([])
    expect(await threadRepo.findById(noneCtx, b.threadId)).toBeUndefined()
    expect(await messageRepo.findById(noneCtx, b.messageId)).toBeUndefined()
    expect(await messageRepo.findByThreadId(noneCtx, b.threadId)).toEqual([])
  })
})

// Type-only export so the test file is self-contained even before the impl exists.
beforeAll(() => {
  // Smoke check that the test runner can resolve the repos. Forces the
  // import-time error if the symbols don't exist yet (RED phase).
  expect(typeof DrizzleThreadRepository).toBe('function')
  expect(typeof DrizzleMessageRepository).toBe('function')
})
