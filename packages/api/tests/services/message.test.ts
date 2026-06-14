import { beforeEach, describe, expect, it } from 'vitest'
import { type AuthUser, toCallerContext } from '../../src/middleware/auth'
import {
  InMemoryMessageRepository,
  InMemoryThreadRepository,
} from '../../src/repositories/in-memory'
import { MessageService } from '../../src/services/message'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'

let threadRepo: InMemoryThreadRepository
let messageRepo: InMemoryMessageRepository
let service: MessageService

function ctxFor(userId: string, role: AuthUser['role'] = 'RENTER') {
  return toCallerContext({ id: userId, role })
}

beforeEach(() => {
  threadRepo = new InMemoryThreadRepository()
  messageRepo = new InMemoryMessageRepository(threadRepo)
  service = new MessageService(threadRepo, messageRepo)
})

describe('MessageService.createThread', () => {
  it('forbids a non-privileged caller from creating a thread they are not in', async () => {
    const result = await service.createThread(ctxFor(U1, 'RENTER'), { participantIds: [U2, U3] })

    expect(result).toEqual({ kind: 'forbidden' })
  })

  it('lets a privileged caller create a thread between other users (status 201)', async () => {
    const result = await service.createThread(ctxFor(U1, 'PLATFORM_ADMIN'), {
      participantIds: [U2, U3],
    })

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.status).toBe(201)
  })

  it('forbids a legacy STAFF caller from creating a thread between other users — revoked by #487', async () => {
    const result = await service.createThread(ctxFor(U1, 'STAFF'), { participantIds: [U2, U3] })

    expect(result).toEqual({ kind: 'forbidden' })
  })

  it('replays an idempotency key: second create returns status 200 and the same thread', async () => {
    const ctx = ctxFor(U1, 'RENTER')
    const input = { participantIds: [U1, U2], idempotencyKey: 'key-thread-1' }

    const first = await service.createThread(ctx, input)
    const second = await service.createThread(ctx, input)

    if (first.kind !== 'created' || second.kind !== 'created') throw new Error('expected created')
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.thread.id).toBe(first.thread.id)
  })
})

describe('MessageService.createMessage', () => {
  it('replays an idempotency key: second send returns status 200 and the same message', async () => {
    const ctx = ctxFor(U1, 'RENTER')
    const created = await service.createThread(ctx, { participantIds: [U1, U2] })
    if (created.kind !== 'created') throw new Error('expected created')
    const threadId = created.thread.id

    const first = await service.createMessage(ctx, threadId, 'hi', 'key-msg-1')
    const second = await service.createMessage(ctx, threadId, 'hi', 'key-msg-1')

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.message.id).toBe(first.message.id)
  })
})

describe('MessageService.markRead', () => {
  it('reports thread_not_found for a thread the caller cannot reach', async () => {
    const result = await service.markRead(ctxFor(U3, 'RENTER'), 'no-such-thread')

    expect(result).toEqual({ kind: 'thread_not_found' })
  })
})
