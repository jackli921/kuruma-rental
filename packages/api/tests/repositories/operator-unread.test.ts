// #1205 slice 3 — operator-side unread counter. Mirrors the renter's
// per-participant unreadCount, but tenant-level on the thread: a renter send
// bumps `thread.operatorUnreadCount`, an operator read zeroes it. An operator's
// own reply must NOT bump it (the renter's participant row bumps instead).
import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'

const ADMIN: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const OP = 'op-aaaa'
const RENTER = 'renter-a'
const STAFF = 'staff-a'

const opCtx = (userId: string, operatorId: string): CallerContext => ({
  userId,
  role: 'OPERATOR_OWNER',
  operatorId,
})
const renterCtx = (userId: string): CallerContext => ({ userId, role: 'RENTER' })

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let threadId: string

const operatorUnread = async (): Promise<number> => {
  const thread = await threadRepo.findById(ADMIN, threadId)
  if (!thread) throw new Error('thread missing')
  return thread.operatorUnreadCount
}

beforeEach(async () => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  threadId = (await threadRepo.create(ADMIN, 'booking-a', [RENTER, STAFF], null, OP)).id
})

describe('operator unread counter (InMemory)', () => {
  it('starts at zero on a fresh thread', async () => {
    expect(await operatorUnread()).toBe(0)
  })

  it('increments on each renter send', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    expect(await operatorUnread()).toBe(1)
    await messageRepo.create(renterCtx(RENTER), threadId, 'still there?')
    expect(await operatorUnread()).toBe(2)
  })

  it('does NOT increment on an operator reply', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    await messageRepo.create(opCtx(STAFF, OP), threadId, 'how can I help?')
    expect(await operatorUnread()).toBe(1)
  })

  it('zeroes when the operator reads', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    await messageRepo.create(renterCtx(RENTER), threadId, 'again')
    await threadRepo.markAsRead(opCtx(STAFF, OP), threadId)
    expect(await operatorUnread()).toBe(0)
  })

  it('is NOT zeroed when the renter reads their own side', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    await threadRepo.markAsRead(renterCtx(RENTER), threadId)
    expect(await operatorUnread()).toBe(1)
  })
})

// #1205 slice 4: create() surfaces the post-bump operator-unread state so the
// service can fire the OPERATOR_NEW_MESSAGE email on the 0->1 transition without a
// read-then-check race. The repo reports STATE (count); the service owns the policy
// (count === 1 ⟺ the window opened).
describe('operator-unread transition signal from create() (InMemory)', () => {
  it('returns the post-bump state on the first renter send into a booking+operator thread', async () => {
    const { message, operatorUnread } = await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    expect(message.content).toBe('hi')
    expect(operatorUnread).toEqual({ operatorId: OP, bookingId: 'booking-a', unreadCount: 1 })
  })

  it('returns the running count on subsequent renter sends (service decides 0->1 via === 1)', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    const { operatorUnread } = await messageRepo.create(renterCtx(RENTER), threadId, 'again')
    expect(operatorUnread).toEqual({ operatorId: OP, bookingId: 'booking-a', unreadCount: 2 })
  })

  it('returns null operatorUnread on an operator reply (no email trigger)', async () => {
    await messageRepo.create(renterCtx(RENTER), threadId, 'hi')
    const { operatorUnread } = await messageRepo.create(
      opCtx(STAFF, OP),
      threadId,
      'how can I help?',
    )
    expect(operatorUnread).toBeNull()
  })

  it('returns null when the thread has no operator/booking (a bookingless thread)', async () => {
    const bareThreadId = (await threadRepo.create(ADMIN, null, [RENTER], null, null)).id
    const { operatorUnread } = await messageRepo.create(renterCtx(RENTER), bareThreadId, 'hi')
    expect(operatorUnread).toBeNull()
  })
})
