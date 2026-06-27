// #1205 slice 2 — operator tenant scoping for threads + messages (the security
// core of the messaging un-gate). Replaces the fail-closed
// `rejectOperatorContextUntilScoped` gate with real operatorId-scoped reads:
// an OPERATOR_* caller sees only threads where `thread.operatorId` matches its
// own tenant. The centerpiece is the cross-tenant-leak assertions: operator A
// must never read operator B's threads or messages.
import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'

const ADMIN: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }

const OP_A = 'op-aaaa'
const OP_B = 'op-bbbb'
const RENTER_A = 'renter-a'
const RENTER_B = 'renter-b'
const STAFF_A = 'staff-a'
const STAFF_B = 'staff-b'

const opCtx = (userId: string, operatorId: string): CallerContext => ({
  userId,
  role: 'OPERATOR_OWNER',
  operatorId,
})
const renterCtx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let threadA: { id: string }
let threadB: { id: string }
let msgAId: string
let msgBId: string

beforeEach(async () => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)

  // Seed with an admin context (operators do not create threads — ensureThread
  // does, server-side). operatorId is the tenant boundary under test.
  threadA = await threadRepo.create(ADMIN, 'booking-a', [RENTER_A], null, OP_A)
  threadB = await threadRepo.create(ADMIN, 'booking-b', [RENTER_B], null, OP_B)
  msgAId = (await messageRepo.create(renterCtx(RENTER_A), threadA.id, 'hi from A')).message.id
  msgBId = (await messageRepo.create(renterCtx(RENTER_B), threadB.id, 'hi from B')).message.id
})

describe('operator thread scoping (InMemory)', () => {
  it('findAll returns only the operator’s own tenant threads', async () => {
    const aThreads = await threadRepo.findAll(opCtx(STAFF_A, OP_A))
    expect(aThreads.map((t) => t.id)).toEqual([threadA.id])

    const bThreads = await threadRepo.findAll(opCtx(STAFF_B, OP_B))
    expect(bThreads.map((t) => t.id)).toEqual([threadB.id])
  })

  it('findById LEAK: operator A cannot read operator B’s thread', async () => {
    expect(await threadRepo.findById(opCtx(STAFF_A, OP_A), threadB.id)).toBeUndefined()
  })

  it('findById: operator A can read its own thread (with messages)', async () => {
    const found = await threadRepo.findById(opCtx(STAFF_A, OP_A), threadA.id)
    expect(found?.id).toBe(threadA.id)
    expect(found?.messages.map((m) => m.content)).toEqual(['hi from A'])
  })

  it('findByIdempotencyKey LEAK: operator A cannot match operator B’s thread', async () => {
    const keyed = await threadRepo.create(ADMIN, 'booking-c', [RENTER_B], 'key-b', OP_B)
    expect(await threadRepo.findByIdempotencyKey(opCtx(STAFF_A, OP_A), 'key-b')).toBeUndefined()
    // sanity: B’s own operator matches it
    expect((await threadRepo.findByIdempotencyKey(opCtx(STAFF_B, OP_B), 'key-b'))?.id).toBe(
      keyed.id,
    )
  })

  it('an operator missing its operatorId reads nothing (fail-closed)', async () => {
    const tokenless: CallerContext = { userId: STAFF_A, role: 'OPERATOR_OWNER' }
    expect(await threadRepo.findAll(tokenless)).toEqual([])
    expect(await threadRepo.findById(tokenless, threadA.id)).toBeUndefined()
  })

  it('renter scoping is unchanged (participant-membership)', async () => {
    const aThreads = await threadRepo.findAll(renterCtx(RENTER_A))
    expect(aThreads.map((t) => t.id)).toEqual([threadA.id])
    // renter A is not a participant of thread B
    expect(await threadRepo.findById(renterCtx(RENTER_A), threadB.id)).toBeUndefined()
  })

  it('PLATFORM_ADMIN still sees every tenant’s threads', async () => {
    const all = await threadRepo.findAll(ADMIN)
    expect(all.map((t) => t.id).sort()).toEqual([threadA.id, threadB.id].sort())
  })
})

describe('operator message scoping (InMemory)', () => {
  it('findById LEAK: operator A cannot read a message in operator B’s thread', async () => {
    expect(await messageRepo.findById(opCtx(STAFF_A, OP_A), msgBId)).toBeUndefined()
  })

  it('findById: operator A can read a message in its own thread', async () => {
    expect((await messageRepo.findById(opCtx(STAFF_A, OP_A), msgAId))?.id).toBe(msgAId)
  })

  it('findByThreadId LEAK: operator A gets nothing for operator B’s thread', async () => {
    expect(await messageRepo.findByThreadId(opCtx(STAFF_A, OP_A), threadB.id)).toEqual([])
  })

  it('findByThreadId: operator A reads its own thread’s messages', async () => {
    const msgs = await messageRepo.findByThreadId(opCtx(STAFF_A, OP_A), threadA.id)
    expect(msgs.map((m) => m.content)).toEqual(['hi from A'])
  })

  it('operator A can reply in its own thread; renter unread bumps', async () => {
    const { message: reply } = await messageRepo.create(
      opCtx(STAFF_A, OP_A),
      threadA.id,
      'operator reply',
    )
    expect(reply.senderId).toBe(STAFF_A)

    const found = await threadRepo.findById(ADMIN, threadA.id)
    const renterP = found?.participants.find((p) => p.userId === RENTER_A)
    expect(renterP?.unreadCount).toBe(1)
  })
})
