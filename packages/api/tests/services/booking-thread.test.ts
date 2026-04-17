// Slice: auto-create thread on booking confirmation (#300).
// BookingService, when configured with a ThreadRepository + staff user id,
// creates a thread between renter and staff after a booking is confirmed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { ThreadRepository } from '../../src/repositories/types'
import { BookingService } from '../../src/services/booking'
import type { Thread, User } from '../../src/stores'

const RENTER = '00000000-0000-4000-8000-0000000000a1'
const STAFF = '00000000-0000-4000-8000-0000000000b1'
const V1 = '00000000-0000-4000-8000-000000000001'

const renterCtx: CallerContext = { userId: RENTER, role: 'RENTER' }

function futureDate(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
}

function stubThread(bookingId: string, participantIds: string[]): Thread {
  return {
    id: `thread-${bookingId}`,
    bookingId,
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: participantIds.map((userId) => ({
      id: `part-${userId}`,
      threadId: `thread-${bookingId}`,
      userId,
      unreadCount: 0,
    })),
    messages: [],
  } as unknown as Thread
}

function makeMockThreadRepo(): ThreadRepository & {
  create: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(async (_ctx, bookingId, participantIds) =>
    stubThread(bookingId ?? 'none', participantIds),
  )
  return {
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => undefined),
    findByIdempotencyKey: vi.fn(async () => undefined),
    create,
    markAsRead: vi.fn(async () => undefined),
  }
}

function makeService(threadRepo?: ThreadRepository, staffUserId?: string) {
  const bookingRepo = new InMemoryBookingRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const userStore = new Map<string, User>([
    [RENTER, { id: RENTER, name: 'R', email: 'r@x', phone: null, language: 'en' }],
    [STAFF, { id: STAFF, name: 'S', email: 's@x', phone: null, language: 'en' }],
  ])
  const userRepo = new InMemoryUserRepository(userStore)
  const service = new BookingService(
    bookingRepo,
    vehicleRepo,
    userRepo,
    threadRepo && staffUserId ? { threadRepo, staffUserId } : undefined,
  )
  return { service, bookingRepo }
}

describe('BookingService.create — auto-thread on confirmation', () => {
  let threadRepo: ReturnType<typeof makeMockThreadRepo>

  beforeEach(() => {
    threadRepo = makeMockThreadRepo()
  })

  it('creates a thread with renter + staff as participants after successful booking', async () => {
    const { service } = makeService(threadRepo, STAFF)
    const result = await service.create(renterCtx, {
      vehicleId: V1,
      renterId: RENTER,
      startAt: futureDate(24),
      endAt: futureDate(48),
      source: 'DIRECT',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
    const [ctxArg, bookingIdArg, participantIds] = threadRepo.create.mock.calls[0]!
    expect(ctxArg).toEqual(renterCtx)
    expect(bookingIdArg).toBe(result.booking.id)
    expect([...(participantIds as string[])].sort()).toEqual([RENTER, STAFF].sort())
  })

  it('does not create a thread when threading is not configured (back-compat)', async () => {
    const { service } = makeService() // no threadRepo
    const result = await service.create(renterCtx, {
      vehicleId: V1,
      renterId: RENTER,
      startAt: futureDate(24),
      endAt: futureDate(48),
      source: 'DIRECT',
    })
    expect(result.ok).toBe(true)
    // No thread repo wired → no call to verify. The fact that the booking
    // still succeeds proves threading is opt-in.
  })

  it('does not create a duplicate thread on an idempotent replay', async () => {
    const { service } = makeService(threadRepo, STAFF)
    const input = {
      vehicleId: V1,
      renterId: RENTER,
      startAt: futureDate(24),
      endAt: futureDate(48),
      source: 'DIRECT' as const,
      idempotencyKey: 'same-key',
    }

    const first = await service.create(renterCtx, input)
    const second = await service.create(renterCtx, input)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.booking.id).toBe(first.booking.id)
    // Thread must be created exactly once across both calls.
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
  })

  it('still returns the booking if thread creation throws', async () => {
    // A messaging outage must not roll back the booking — the booking is
    // authoritative; threads can be repaired async later.
    threadRepo.create = vi.fn(async () => {
      throw new Error('thread service down')
    })
    const { service } = makeService(threadRepo, STAFF)

    const result = await service.create(renterCtx, {
      vehicleId: V1,
      renterId: RENTER,
      startAt: futureDate(24),
      endAt: futureDate(48),
      source: 'DIRECT',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.id).toBeTruthy()
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
  })
})
