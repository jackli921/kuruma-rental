import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryMessageRepository } from '../../src/repositories/in-memory/message'
import { InMemoryThreadRepository } from '../../src/repositories/in-memory/thread'

// Repos NOT yet operator-scoped in slice 1 (#386) must fail closed for any
// tenant-scoped caller rather than silently serving cross-tenant data. The
// guard throws before any I/O, so the call arguments below are throwaway
// stubs — only the OPERATOR_* context matters.
const operatorCtx: CallerContext = {
  userId: 'op-user',
  role: 'OPERATOR_OWNER',
  operatorId: 'op_a',
  bypassScope: false,
}

type Invocation = readonly [method: string, run: () => Promise<unknown>]

describe('BookingRepository rejects OPERATOR_* until scoped', () => {
  const repo = new InMemoryBookingRepository()
  const invocations: Invocation[] = [
    ['findAll', () => repo.findAll(operatorCtx)],
    ['findById', () => repo.findById(operatorCtx, 'b1')],
    ['findByIdempotencyKey', () => repo.findByIdempotencyKey(operatorCtx, 'k1')],
    // biome-ignore lint/suspicious/noExplicitAny: throwaway stub; guard throws first
    ['create', () => repo.create(operatorCtx, {} as any)],
    [
      'updateStatus',
      () => repo.updateStatus(operatorCtx, 'b1', { from: 'CONFIRMED', to: 'ACTIVE' }),
    ],
    [
      'cancel',
      () => repo.cancel(operatorCtx, 'b1', { from: 'CONFIRMED', fee: 0, cancelledAt: new Date() }),
    ],
  ]

  it.each(invocations)('%s throws ForbiddenError naming the repo', async (_method, run) => {
    await expect(run()).rejects.toThrow(ForbiddenError)
    await expect(run()).rejects.toThrow('BookingRepository not yet operator-scoped')
  })
})

describe('ThreadRepository rejects OPERATOR_* until scoped', () => {
  const repo = new InMemoryThreadRepository()
  const invocations: Invocation[] = [
    ['findAll', () => repo.findAll(operatorCtx)],
    ['findById', () => repo.findById(operatorCtx, 't1')],
    ['findByIdempotencyKey', () => repo.findByIdempotencyKey(operatorCtx, 'k1')],
    ['create', () => repo.create(operatorCtx, null, ['u1'])],
    ['markAsRead', () => repo.markAsRead(operatorCtx, 't1')],
  ]

  it.each(invocations)('%s throws ForbiddenError naming the repo', async (_method, run) => {
    await expect(run()).rejects.toThrow(ForbiddenError)
    await expect(run()).rejects.toThrow('ThreadRepository not yet operator-scoped')
  })
})

describe('MessageRepository rejects OPERATOR_* until scoped', () => {
  const repo = new InMemoryMessageRepository(new InMemoryThreadRepository())
  const invocations: Invocation[] = [
    ['findById', () => repo.findById(operatorCtx, 'm1')],
    ['findByIdempotencyKey', () => repo.findByIdempotencyKey(operatorCtx, 'k1')],
    ['create', () => repo.create(operatorCtx, 't1', 'hello')],
    ['findByThreadId', () => repo.findByThreadId(operatorCtx, 't1')],
  ]

  it.each(invocations)('%s throws ForbiddenError naming the repo', async (_method, run) => {
    await expect(run()).rejects.toThrow(ForbiddenError)
    await expect(run()).rejects.toThrow('MessageRepository not yet operator-scoped')
  })
})
