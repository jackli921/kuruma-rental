// Slice: auto-create thread on booking confirmation (#300), updated for the
// slice-6 (#392) selected-vehicle submit. BookingService, when configured with
// a ThreadRepository + staff user id, creates a renter/staff thread AFTER a
// booking commits — its failure never rolls back the booking.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryBookingEventRepository,
  InMemoryBookingRepository,
  InMemoryFeeScheduleRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type {
  RunInTransaction,
  ThreadRepository,
  TransactionRepos,
} from '../../src/repositories/types'
import { BookingService } from '../../src/services/booking'
import { BookingPostCommitDispatcher } from '../../src/services/booking-post-commit-dispatcher'
import type { CreateBookingInput } from '../../src/services/booking-types'
import { makeEnsureThread } from '../../src/services/ensure-thread'
import type { Thread, User, Vehicle } from '../../src/stores'

const RENTER = '00000000-0000-4000-8000-0000000000a1'
const STAFF = '00000000-0000-4000-8000-0000000000b1'
const OP = 'op-thread'
const CLASS = 'class-thread'

const renterCtx: CallerContext = { userId: RENTER, role: 'RENTER', bypassScope: false }

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
  findByIdempotencyKey: ReturnType<typeof vi.fn>
} {
  const byKey = new Map<string, Thread>()
  const create = vi.fn(async (_ctx, bookingId, participantIds, idempotencyKey) => {
    const thread = stubThread(bookingId ?? 'none', participantIds)
    if (idempotencyKey) byKey.set(idempotencyKey, thread)
    return thread
  })
  const findByIdempotencyKey = vi.fn(async (_ctx: CallerContext, k: string) => byKey.get(k))
  return {
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => undefined),
    findByIdempotencyKey,
    create,
    markAsRead: vi.fn(async () => undefined),
  }
}

function vehicleData(o: Partial<Vehicle> = {}): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OP,
    classId: CLASS,
    pickupLocationId: null,
    name: 'Compact',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...o,
  }
}

async function makeService(threadRepo?: ThreadRepository, staffUserId?: string) {
  const bookingRepo = new InMemoryBookingRepository()
  const bookingEventRepo = new InMemoryBookingEventRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const locationRepo = new InMemoryLocationRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const addOnRepo = new InMemoryAddOnRepository()
  const feeScheduleRepo = new InMemoryFeeScheduleRepository()
  const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()

  const location = await locationRepo.create({
    operatorId: OP,
    name: 'Osaka',
    address: '1-2-3',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  })
  const vehicle = await vehicleRepo.create(
    SYSTEM_CONTEXT,
    vehicleData({ pickupLocationId: location.id }),
  )

  const userStore = new Map<string, User>([
    [
      RENTER,
      {
        id: RENTER,
        name: 'R',
        email: 'r@x',
        phone: null,
        language: 'en',
        country: null,
        role: 'RENTER',
      },
    ],
    [
      STAFF,
      {
        id: STAFF,
        name: 'S',
        email: 's@x',
        phone: null,
        language: 'en',
        country: null,
        role: 'OPERATOR_STAFF',
      },
    ],
  ])
  const userRepo = new InMemoryUserRepository(userStore)

  const repos: TransactionRepos = {
    vehicleRepo,
    maintenanceLogRepo,
    bookingRepo,
    bookingEventRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    userRepo,
  }
  const runInTransaction: RunInTransaction = async (fn) => fn(repos)

  // Compose the post-commit seam exactly as index.ts does: ensureThread (when a
  // staff user is configured) + a no-op notification dispatch (this suite asserts
  // thread autocreate, not email).
  const postCommit =
    threadRepo && staffUserId
      ? new BookingPostCommitDispatcher(makeEnsureThread({ threadRepo, staffUserId }), {
          dispatch: async () => {},
        })
      : undefined
  const service = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    postCommit,
  )
  return { service, bookingRepo, vehicleId: vehicle.id, locationId: location.id }
}

function bookingInput(
  vehicleId: string,
  locationId: string,
  o: Partial<CreateBookingInput> = {},
): CreateBookingInput {
  return {
    requestedVehicleId: vehicleId,
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    renterId: RENTER,
    startAt: futureDate(24),
    endAt: futureDate(48),
    source: 'DIRECT',
    addOnIds: [],
    ...o,
  }
}

describe('BookingService.create — auto-thread on confirmation', () => {
  let threadRepo: ReturnType<typeof makeMockThreadRepo>

  beforeEach(() => {
    threadRepo = makeMockThreadRepo()
  })

  it('creates a thread with renter + staff as participants after successful booking', async () => {
    const { service, vehicleId, locationId } = await makeService(threadRepo, STAFF)
    const result = await service.create(renterCtx, bookingInput(vehicleId, locationId))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
    const [ctxArg, bookingIdArg, participantIds] = threadRepo.create.mock.calls[0]!
    expect(ctxArg).toEqual(renterCtx)
    expect(bookingIdArg).toBe(result.booking.id)
    expect([...(participantIds as string[])].sort()).toEqual([RENTER, STAFF].sort())
  })

  it('does not touch the thread repo when threading is not configured (back-compat)', async () => {
    const { service, vehicleId, locationId } = await makeService(threadRepo) // no staffUserId
    const result = await service.create(renterCtx, bookingInput(vehicleId, locationId))
    expect(result.ok).toBe(true)
    expect(threadRepo.create).not.toHaveBeenCalled()
    expect(threadRepo.findByIdempotencyKey).not.toHaveBeenCalled()
  })

  it('does not create a duplicate thread on an idempotent replay', async () => {
    const { service, vehicleId, locationId } = await makeService(threadRepo, STAFF)
    const input = bookingInput(vehicleId, locationId, {
      idempotencyKey: '00000000-0000-4000-8000-00000000c001',
    })

    const first = await service.create(renterCtx, input)
    const second = await service.create(renterCtx, input)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.booking.id).toBe(first.booking.id)
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
  })

  it('still returns the booking if thread creation throws, and emits a structured log', async () => {
    threadRepo.create = vi.fn(async () => {
      throw new Error('thread service down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, vehicleId, locationId } = await makeService(threadRepo, STAFF)

    const result = await service.create(renterCtx, bookingInput(vehicleId, locationId))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.id).toBeTruthy()
    expect(threadRepo.create).toHaveBeenCalledTimes(1)
    const logged = errorSpy.mock.calls.map((c) => c[0] as string).join('\n')
    expect(logged).toContain('thread_autocreate_failed')
    expect(logged).toContain(result.booking.id)
    errorSpy.mockRestore()
  })

  it('repairs a missing thread on idempotent replay when the first attempt failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let callCount = 0
    threadRepo.create = vi.fn(async (_ctx, bookingId, participantIds) => {
      callCount++
      if (callCount === 1) throw new Error('transient outage')
      return stubThread(bookingId ?? 'none', participantIds)
    })

    const { service, vehicleId, locationId } = await makeService(threadRepo, STAFF)
    const input = bookingInput(vehicleId, locationId, {
      idempotencyKey: '00000000-0000-4000-8000-00000000c002',
    })

    const first = await service.create(renterCtx, input)
    expect(first.ok).toBe(true)
    expect(threadRepo.create).toHaveBeenCalledTimes(1) // failed

    const second = await service.create(renterCtx, input)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.booking.id).toBe(first.booking.id)
    expect(threadRepo.create).toHaveBeenCalledTimes(2) // second attempt succeeded

    errorSpy.mockRestore()
  })
})
