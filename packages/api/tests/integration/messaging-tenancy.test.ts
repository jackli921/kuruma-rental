// #1205 slice 2 — operator tenant scoping against a real Postgres (issue #28
// harness). The InMemory twin lives in tests/repositories/messaging-tenancy.test.ts;
// this file proves the Drizzle repos enforce the same cross-tenant seal: an
// OPERATOR_* caller reads/replies only threads where threads.operatorId matches
// its own tenant. Run via vitest.integration.config.ts against the docker pg
// (DATABASE_URL set, migrated to >= 0089).
import type { RunTx } from '@kuruma/shared/db'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

let opA: string
let opB: string
let renterA: string
let renterB: string
let staffA: string
let threadA: string
let threadB: string
let msgAId: string
let msgBId: string

beforeEach(async () => {
  ;[opA, opB] = (await createTestOperators(2)) as [string, string]
  createdOperatorIds.push(opA, opB)
  ;[renterA, renterB, staffA] = (await createTestUsers(3)) as [string, string, string]
  createdUserIds.push(renterA, renterB, staffA)

  threadA = (await threadRepo.create(ADMIN, null, [renterA], null, opA)).id
  threadB = (await threadRepo.create(ADMIN, null, [renterB], null, opB)).id
  msgAId = (await messageRepo.create(renterCtx(renterA), threadA, 'hi from A')).id
  msgBId = (await messageRepo.create(renterCtx(renterB), threadB, 'hi from B')).id
})

afterEach(async () => {
  await cleanupMessaging(createdUserIds)
  await cleanupOperators(createdOperatorIds)
  createdUserIds.length = 0
  createdOperatorIds.length = 0
})

describe('operator thread scoping (Drizzle)', () => {
  it('findAll returns only the operator’s own tenant threads', async () => {
    expect((await threadRepo.findAll(opCtx(staffA, opA))).map((t) => t.id)).toEqual([threadA])
    expect((await threadRepo.findAll(opCtx(staffA, opB))).map((t) => t.id)).toEqual([threadB])
  })

  it('findById LEAK: operator A cannot read operator B’s thread', async () => {
    expect(await threadRepo.findById(opCtx(staffA, opA), threadB)).toBeUndefined()
  })

  it('findById: operator A reads its own thread with messages', async () => {
    const found = await threadRepo.findById(opCtx(staffA, opA), threadA)
    expect(found?.id).toBe(threadA)
    expect(found?.messages.map((m) => m.content)).toEqual(['hi from A'])
  })

  it('findByIdempotencyKey LEAK: operator A cannot match operator B’s thread', async () => {
    await threadRepo.create(ADMIN, null, [renterB], 'idem-b', opB)
    expect(await threadRepo.findByIdempotencyKey(opCtx(staffA, opA), 'idem-b')).toBeUndefined()
    expect((await threadRepo.findByIdempotencyKey(opCtx(staffA, opB), 'idem-b'))?.operatorId).toBe(
      opB,
    )
  })

  it('an operator missing its operatorId reads nothing (fail-closed)', async () => {
    const tokenless: CallerContext = { userId: staffA, role: 'OPERATOR_OWNER' }
    expect(await threadRepo.findAll(tokenless)).toEqual([])
    expect(await threadRepo.findById(tokenless, threadA)).toBeUndefined()
  })

  it('renter scoping is unchanged (participant-membership)', async () => {
    expect((await threadRepo.findAll(renterCtx(renterA))).map((t) => t.id)).toEqual([threadA])
    expect(await threadRepo.findById(renterCtx(renterA), threadB)).toBeUndefined()
  })

  it('PLATFORM_ADMIN still sees every tenant’s threads', async () => {
    const ids = (await threadRepo.findAll(ADMIN)).map((t) => t.id)
    expect(ids).toContain(threadA)
    expect(ids).toContain(threadB)
  })
})

describe('operator message scoping (Drizzle)', () => {
  it('findById LEAK: operator A cannot read a message in operator B’s thread', async () => {
    expect(await messageRepo.findById(opCtx(staffA, opA), msgBId)).toBeUndefined()
  })

  it('findById: operator A reads a message in its own thread', async () => {
    expect((await messageRepo.findById(opCtx(staffA, opA), msgAId))?.id).toBe(msgAId)
  })

  it('findByThreadId LEAK: operator A gets nothing for operator B’s thread', async () => {
    expect(await messageRepo.findByThreadId(opCtx(staffA, opA), threadB)).toEqual([])
  })

  it('findByThreadId: operator A reads its own thread’s messages', async () => {
    const msgs = await messageRepo.findByThreadId(opCtx(staffA, opA), threadA)
    expect(msgs.map((m) => m.content)).toEqual(['hi from A'])
  })

  it('operator A can reply in its own thread; renter unread bumps', async () => {
    const reply = await messageRepo.create(opCtx(staffA, opA), threadA, 'operator reply')
    expect(reply.senderId).toBe(staffA)

    const found = await threadRepo.findById(ADMIN, threadA)
    const renterP = found?.participants.find((p) => p.userId === renterA)
    expect(renterP?.unreadCount).toBe(1)
  })
})

beforeAll(() => {
  expect(typeof DrizzleThreadRepository).toBe('function')
  expect(typeof DrizzleMessageRepository).toBe('function')
})
