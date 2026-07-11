import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AuthUser, ConflictError, toCallerContext } from '../../src/middleware/auth'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { MessageService, type NotifyOperatorNewMessage } from '../../src/services/message'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'
const OP_USER = '00000000-0000-4000-8000-0000000000b1'
const OPERATOR_ID = 'op-1'
const BOOKING_ID = 'bk-1'

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let notifyOperatorNewMessage: ReturnType<typeof vi.fn<NotifyOperatorNewMessage>>
let service: MessageService

function ctxFor(userId: string, role: AuthUser['role'] = 'RENTER', operatorId?: string) {
  return toCallerContext({ id: userId, role, ...(operatorId ? { operatorId } : {}) })
}

// Seed a booking+operator thread directly: the booking flow's ensureThread stamps
// operatorId from the booking, which we shortcut here to exercise the alert trigger.
async function seedBookingThread(): Promise<string> {
  const thread = await threadRepo.create(
    ctxFor(U1, 'RENTER'),
    BOOKING_ID,
    [U1, OP_USER],
    null,
    OPERATOR_ID,
  )
  return thread.id
}

beforeEach(() => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  notifyOperatorNewMessage = vi.fn<NotifyOperatorNewMessage>(async () => {})
  service = new MessageService(threadRepo, messageRepo, notifyOperatorNewMessage)
})

describe('MessageService.createMessage', () => {
  it('replays an idempotency key: second send returns status 200 and the same message', async () => {
    const ctx = ctxFor(U1, 'RENTER')
    const thread = await threadRepo.create(ctx, null, [U1, U2], null, null)
    const threadId = thread.id

    const first = await service.createMessage(ctx, threadId, 'hi', 'key-msg-1')
    const second = await service.createMessage(ctx, threadId, 'hi', 'key-msg-1')

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.message.id).toBe(first.message.id)
  })

  // Messaging GA hardening (Refs #1476): idempotencyKey is globally unique, but
  // findByIdempotencyKey is sender-scoped (#328). So a DIFFERENT sender replaying
  // another sender's key can't resolve it on re-fetch — that used to escape as the
  // raw UNIQUE_VIOLATION (a 500). Surface it as a ConflictError (-> 409) instead:
  // a clean "key already claimed" client error, and no cross-sender existence leak.
  it('throws ConflictError when a different sender replays another sender key', async () => {
    const ctxU1 = ctxFor(U1, 'RENTER')
    const thread = await threadRepo.create(ctxU1, null, [U1, U2], null, null)
    const sharedKey = 'shared-key-collision'

    await service.createMessage(ctxU1, thread.id, 'from u1', sharedKey)

    await expect(
      service.createMessage(ctxFor(U2, 'RENTER'), thread.id, 'from u2', sharedKey),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

// #1205 slice 4: the operator-alert trigger. A renter opening a NEW unread window
// (the operator-unread 0->1 transition, on a fresh insert) is the only event that
// fires the alert — re-arming only after the operator reads the thread.
describe('MessageService.createMessage operator alert (#1205)', () => {
  it('alerts the operator on the renter first unread message (0->1), with exact args', async () => {
    const threadId = await seedBookingThread()
    const { message, status } = await service.createMessage(
      ctxFor(U1, 'RENTER'),
      threadId,
      'hello',
      null,
    )

    expect(status).toBe(201)
    expect(notifyOperatorNewMessage).toHaveBeenCalledTimes(1)
    expect(notifyOperatorNewMessage).toHaveBeenCalledWith({
      threadId,
      bookingId: BOOKING_ID,
      operatorId: OPERATOR_ID,
      messageId: message.id,
      senderUserId: U1,
    })
  })

  it('does not re-alert on the renter second unread message (1->2)', async () => {
    const threadId = await seedBookingThread()
    await service.createMessage(ctxFor(U1, 'RENTER'), threadId, 'first', null)
    await service.createMessage(ctxFor(U1, 'RENTER'), threadId, 'second', null)

    expect(notifyOperatorNewMessage).toHaveBeenCalledTimes(1) // the first only
  })

  it('does not alert when the operator sends (no operator-unread transition)', async () => {
    const threadId = await seedBookingThread()
    await service.createMessage(
      ctxFor(OP_USER, 'OPERATOR_OWNER', OPERATOR_ID),
      threadId,
      'reply',
      null,
    )

    expect(notifyOperatorNewMessage).not.toHaveBeenCalled()
  })

  it('does not re-alert on an idempotent replay (status 200)', async () => {
    const threadId = await seedBookingThread()
    await service.createMessage(ctxFor(U1, 'RENTER'), threadId, 'hi', 'key-1')
    await service.createMessage(ctxFor(U1, 'RENTER'), threadId, 'hi', 'key-1') // replay

    expect(notifyOperatorNewMessage).toHaveBeenCalledTimes(1)
  })

  it('never fails the message send when the alert hook throws', async () => {
    notifyOperatorNewMessage.mockRejectedValueOnce(new Error('alert outage'))
    const threadId = await seedBookingThread()

    const { status, message } = await service.createMessage(
      ctxFor(U1, 'RENTER'),
      threadId,
      'hi',
      null,
    )

    expect(status).toBe(201)
    expect(message.content).toBe('hi')
  })
})

describe('MessageService.markRead', () => {
  it('reports thread_not_found for a thread the caller cannot reach', async () => {
    const result = await service.markRead(ctxFor(U3, 'RENTER'), 'no-such-thread')

    expect(result).toEqual({ kind: 'thread_not_found' })
  })
})
