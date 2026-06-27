import type { CreateVehicleBlockInput } from '@kuruma/shared/validators/vehicle-block'
import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import type { Booking, Vehicle } from '../stores'
import { VehicleBlockService } from './vehicle-block'

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let bookingRepo: InMemoryBookingRepository
let service: VehicleBlockService

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  bookingRepo = new InMemoryBookingRepository()
  service = new VehicleBlockService(vehicleRepo, blockRepo, bookingRepo)
})

// A complete Booking with sane defaults; tests override only the fields the
// reverse block→booking guard keys on (assignedVehicleId, status, the window).
function makeBooking(overrides: Partial<Booking>): Booking {
  return {
    id: crypto.randomUUID(),
    operatorId: 'op_a',
    renterId: 'renter_1',
    classId: 'class_1',
    requestedVehicleId: null,
    assignedVehicleId: null,
    pickupLocationId: 'loc_1',
    dropoffLocationId: 'loc_1',
    startAt: new Date('2026-07-01T09:00:00.000Z'),
    endAt: new Date('2026-07-01T17:00:00.000Z'),
    effectiveEndAt: new Date('2026-07-01T17:00:00.000Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'TESTBK01',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancellationFeeSettlement: 'ADVISORY',
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}

// A service whose booking repo is pre-seeded with the given bookings, so the
// reverse guard sees a live booking on the car. Other repos stay shared/empty.
function serviceWithBookings(bookings: Booking[]): VehicleBlockService {
  const seeded = new InMemoryBookingRepository(new Map(bookings.map((b) => [b.id, b])))
  return new VehicleBlockService(vehicleRepo, blockRepo, seeded)
}

function ctxFor(operatorId: string): CallerContext {
  return { userId: `user_${operatorId}`, role: 'OPERATOR_OWNER', operatorId }
}

function seedVehicle(operatorId: string): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId,
    classId: null,
    pickupLocationId: null,
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
  })
}

function blockInput(overrides: Partial<CreateVehicleBlockInput> = {}): CreateVehicleBlockInput {
  return {
    kind: 'MAINTENANCE',
    reason: 'Annual shaken',
    startAt: '2026-07-01T09:00:00.000Z',
    endAt: '2026-07-01T17:00:00.000Z',
    ...overrides,
  }
}

describe('VehicleBlockService.createBlock', () => {
  it('stamps operatorId from the vehicle and createdBy from the caller, never client input', async () => {
    const vehicle = await seedVehicle('op_a')

    const result = await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.block.operatorId).toBe('op_a')
      expect(result.block.vehicleId).toBe(vehicle.id)
      expect(result.block.createdBy).toBe('user_op_a')
      expect(result.block.kind).toBe('MAINTENANCE')
      expect(result.block.startAt).toEqual(new Date('2026-07-01T09:00:00.000Z'))
      expect(result.block.endAt).toEqual(new Date('2026-07-01T17:00:00.000Z'))
      expect(result.block.notes).toBeNull()
    }
  })

  it('returns 404 when the vehicle does not exist', async () => {
    const result = await service.createBlock(ctxFor('op_a'), crypto.randomUUID(), blockInput())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 404 when an operator targets another tenant’s vehicle (scoped resolution)', async () => {
    const foreign = await seedVehicle('op_b')

    const result = await service.createBlock(ctxFor('op_a'), foreign.id, blockInput())

    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 409 VEHICLE_BLOCK_OVERLAP when a block overlaps an existing one on the same vehicle', async () => {
    const vehicle = await seedVehicle('op_a')
    await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    const overlap = await service.createBlock(
      ctxFor('op_a'),
      vehicle.id,
      blockInput({
        startAt: '2026-07-01T12:00:00.000Z',
        endAt: '2026-07-01T20:00:00.000Z',
      }),
    )

    expect(overlap).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_BLOCK_OVERLAP' })
  })

  it('allows an adjacent block (endAt === next startAt) — half-open ranges do not overlap', async () => {
    const vehicle = await seedVehicle('op_a')
    await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    const adjacent = await service.createBlock(
      ctxFor('op_a'),
      vehicle.id,
      blockInput({
        startAt: '2026-07-01T17:00:00.000Z',
        endAt: '2026-07-01T19:00:00.000Z',
      }),
    )

    expect(adjacent.ok).toBe(true)
  })

  it('rejects a non-fleet-write caller at the service layer (defence in depth, #329)', async () => {
    const vehicle = await seedVehicle('op_a')
    const renter: CallerContext = { userId: 'renter', role: 'RENTER' }

    await expect(service.createBlock(renter, vehicle.id, blockInput())).rejects.toThrow(
      'fleet write scope required',
    )
  })
})

describe('VehicleBlockService.createBlock — reverse block→booking guard (#1196)', () => {
  it('returns 409 BLOCK_BOOKING_CONFLICT when a CONFIRMED booking overlaps the block window', async () => {
    const vehicle = await seedVehicle('op_a')
    // booking 08:00–12:00 overlaps the default block 09:00–17:00 on the same car.
    const booking = makeBooking({
      assignedVehicleId: vehicle.id,
      startAt: new Date('2026-07-01T08:00:00.000Z'),
      endAt: new Date('2026-07-01T12:00:00.000Z'),
      effectiveEndAt: new Date('2026-07-01T12:00:00.000Z'),
    })
    const svc = serviceWithBookings([booking])

    const result = await svc.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result).toMatchObject({ ok: false, status: 409, code: 'BLOCK_BOOKING_CONFLICT' })
  })

  it('returns 409 BLOCK_BOOKING_CONFLICT when an ACTIVE booking overlaps the block window', async () => {
    const vehicle = await seedVehicle('op_a')
    // ACTIVE is the other blocking status; a mutation dropping it must fail this.
    const booking = makeBooking({
      assignedVehicleId: vehicle.id,
      status: 'ACTIVE',
      startAt: new Date('2026-07-01T08:00:00.000Z'),
      endAt: new Date('2026-07-01T12:00:00.000Z'),
      effectiveEndAt: new Date('2026-07-01T12:00:00.000Z'),
    })
    const svc = serviceWithBookings([booking])

    const result = await svc.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result).toMatchObject({ ok: false, status: 409, code: 'BLOCK_BOOKING_CONFLICT' })
  })

  it('rejects a block that lands only in the booking dropoff turnaround tail (effectiveEndAt)', async () => {
    const vehicle = await seedVehicle('op_a')
    // ends 17:00 but effectiveEndAt 18:00 (1h turnaround); block 17:30–17:45 sits in the tail.
    const booking = makeBooking({
      assignedVehicleId: vehicle.id,
      startAt: new Date('2026-07-01T09:00:00.000Z'),
      endAt: new Date('2026-07-01T17:00:00.000Z'),
      effectiveEndAt: new Date('2026-07-01T18:00:00.000Z'),
    })
    const svc = serviceWithBookings([booking])

    const result = await svc.createBlock(
      ctxFor('op_a'),
      vehicle.id,
      blockInput({ startAt: '2026-07-01T17:30:00.000Z', endAt: '2026-07-01T17:45:00.000Z' }),
    )

    expect(result).toMatchObject({ ok: false, status: 409, code: 'BLOCK_BOOKING_CONFLICT' })
  })

  it('allows the block when the only overlapping booking is CANCELLED (not a blocking status)', async () => {
    const vehicle = await seedVehicle('op_a')
    const booking = makeBooking({ assignedVehicleId: vehicle.id, status: 'CANCELLED' })
    const svc = serviceWithBookings([booking])

    const result = await svc.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result.ok).toBe(true)
  })

  it('allows a block adjacent to a booking (block.startAt === booking.effectiveEndAt — half-open)', async () => {
    const vehicle = await seedVehicle('op_a')
    const booking = makeBooking({
      assignedVehicleId: vehicle.id,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-01T09:00:00.000Z'),
      effectiveEndAt: new Date('2026-07-01T09:00:00.000Z'),
    })
    const svc = serviceWithBookings([booking])

    // default block starts 09:00 — exactly the booking's effectiveEndAt, so no overlap.
    const result = await svc.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result.ok).toBe(true)
  })

  it('allows the block when the overlapping booking is on a different vehicle', async () => {
    const vehicle = await seedVehicle('op_a')
    const other = await seedVehicle('op_a')
    const booking = makeBooking({ assignedVehicleId: other.id })
    const svc = serviceWithBookings([booking])

    const result = await svc.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result.ok).toBe(true)
  })
})

describe('VehicleBlockService.listBlocks', () => {
  it('operator caller sees only its own blocks in the window', async () => {
    const vA = await seedVehicle('op_a')
    const vB = await seedVehicle('op_b')
    await blockRepo.create({
      operatorId: 'op_a',
      vehicleId: vA.id,
      startAt: new Date('2026-07-01T09:00:00Z'),
      endAt: new Date('2026-07-01T17:00:00Z'),
      kind: 'MAINTENANCE',
      reason: 'x',
      notes: null,
      createdBy: 'u',
    })
    await blockRepo.create({
      operatorId: 'op_b',
      vehicleId: vB.id,
      startAt: new Date('2026-07-01T09:00:00Z'),
      endAt: new Date('2026-07-01T17:00:00Z'),
      kind: 'MAINTENANCE',
      reason: 'y',
      notes: null,
      createdBy: 'u',
    })
    const from = new Date('2026-07-01T00:00:00Z')
    const to = new Date('2026-07-02T00:00:00Z')

    const own = await service.listBlocks(ctxFor('op_a'), from, to)
    expect(own.map((b) => b.operatorId)).toEqual(['op_a'])

    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const all = await service.listBlocks(admin, from, to)
    expect(all.map((b) => b.operatorId).sort()).toEqual(['op_a', 'op_b'])
  })
})

describe('VehicleBlockService.deleteBlock', () => {
  it('removes a block the operator owns', async () => {
    const vehicle = await seedVehicle('op_a')
    const created = await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())
    if (!created.ok) throw new Error('setup failed')

    const result = await service.deleteBlock(ctxFor('op_a'), vehicle.id, created.block.id)

    expect(result).toMatchObject({ ok: true })
    expect(await blockRepo.findById(created.block.id)).toBeUndefined()
  })

  it('returns 404 for an unknown blockId', async () => {
    const vehicle = await seedVehicle('op_a')
    const result = await service.deleteBlock(ctxFor('op_a'), vehicle.id, crypto.randomUUID())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 404 when a different operator tries to delete the block (operator-scoped, defence-in-depth)', async () => {
    const aVehicle = await seedVehicle('op_a')
    const bVehicle = await seedVehicle('op_b')
    const created = await service.createBlock(ctxFor('op_a'), aVehicle.id, blockInput())
    if (!created.ok) throw new Error('setup failed')

    const result = await service.deleteBlock(ctxFor('op_b'), bVehicle.id, created.block.id)

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(await blockRepo.findById(created.block.id)).toBeDefined()
  })

  it('rejects a non-fleet-write caller at the service layer (defence in depth, #329)', async () => {
    const vehicle = await seedVehicle('op_a')
    const renter: CallerContext = { userId: 'renter', role: 'RENTER' }

    await expect(service.deleteBlock(renter, vehicle.id, crypto.randomUUID())).rejects.toThrow(
      'fleet write scope required',
    )
  })
})
