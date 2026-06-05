import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryMessageRepository } from '../../src/repositories/in-memory/message'
import { InMemoryThreadRepository } from '../../src/repositories/in-memory/thread'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import type { Vehicle } from '../../src/stores'
import { bookingInput } from '../helpers/booking'

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

// Slice 6 (#392, proposal §6.2): BookingRepository is now operator-scoped via
// the three-way bookingReadScope (renter-own / operator-own-tenant / bypass /
// none). An OPERATOR_* caller is bounded to its OWN tenant on reads AND writes
// — never fail-closed, never a cross-tenant leak — and a tenant-less operator
// (scope 'none') still fails closed. This supersedes the slice-1 fail-closed
// contract (the repo no longer throws "not yet operator-scoped").
describe('BookingRepository operator-scopes reads and writes (#392)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'op-user',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'op-user', role: 'OPERATOR_OWNER', bypassScope: false }

  const seed = async () => {
    const repo = new InMemoryBookingRepository()
    const a = await repo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: opA,
        renterId: 'renter-a',
        requestedVehicleId: 'veh-a',
        assignedVehicleId: 'veh-a',
        idempotencyKey: 'key-a',
      }),
    )
    const b = await repo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: opB,
        renterId: 'renter-b',
        requestedVehicleId: 'veh-b',
        assignedVehicleId: 'veh-b',
        idempotencyKey: 'key-b',
      }),
    )
    return { repo, a, b }
  }

  it('findAll returns only the caller’s own tenant bookings', async () => {
    const { repo, a } = await seed()
    const rows = await repo.findAll(ctxFor(opA))
    expect(rows.map((r) => r.id)).toEqual([a.id])
  })

  it('findById returns the caller’s own tenant booking but not another tenant’s', async () => {
    const { repo, a, b } = await seed()
    expect(await repo.findById(ctxFor(opA), a.id)).toMatchObject({ id: a.id, operatorId: opA })
    // Cross-tenant: undefined (no existence leak), not a thrown guard.
    expect(await repo.findById(ctxFor(opA), b.id)).toBeUndefined()
  })

  it('findByIdempotencyKey cannot reach another tenant booking', async () => {
    const { repo } = await seed()
    expect(await repo.findByIdempotencyKey(ctxFor(opA), 'key-a')).toMatchObject({ operatorId: opA })
    expect(await repo.findByIdempotencyKey(ctxFor(opA), 'key-b')).toBeUndefined()
  })

  it('updateStatus is a no-op on another tenant booking', async () => {
    const { repo, b } = await seed()
    expect(
      await repo.updateStatus(ctxFor(opA), b.id, { from: 'CONFIRMED', to: 'ACTIVE' }),
    ).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'CONFIRMED' })
  })

  it('cancel is a no-op on another tenant booking', async () => {
    const { repo, b } = await seed()
    expect(
      await repo.cancel(ctxFor(opA), b.id, { from: 'CONFIRMED', fee: 0, cancelledAt: new Date() }),
    ).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'CONFIRMED' })
  })

  it('create rejects booking for another operator', async () => {
    const { repo } = await seed()
    await expect(
      repo.create(ctxFor(opA), bookingInput({ operatorId: opB, assignedVehicleId: 'veh-c' })),
    ).rejects.toThrow(ForbiddenError)
  })

  it('a tenant-less operator fails closed', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(noTenant)).toEqual([])
    await expect(
      repo.create(noTenant, bookingInput({ operatorId: opA, assignedVehicleId: 'veh-d' })),
    ).rejects.toThrow(ForbiddenError)
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

// VehicleRepository IS operator-scoped (#386 F2). An OPERATOR_* caller must be
// bounded to its own tenant on WRITES as well as reads — the repository, not the
// route gate, is the tenant boundary. These prove a cross-tenant mutation is a
// no-op (never a leak) and a tenant-less operator fails closed.
describe('VehicleRepository operator-scopes writes', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const vehicleInput = (operatorId: string, name: string) => ({
    operatorId,
    classId: null,
    name,
    description: null,
    photos: ['https://img/existing.jpg'],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 6500,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })

  const seed = async (): Promise<{ repo: InMemoryVehicleRepository; a: Vehicle; b: Vehicle }> => {
    const repo = new InMemoryVehicleRepository()
    const a = await repo.create(SYSTEM_CONTEXT, vehicleInput(opA, 'Car A'))
    const b = await repo.create(SYSTEM_CONTEXT, vehicleInput(opB, 'Car B'))
    return { repo, a, b }
  }

  it('update cannot reach another tenant vehicle (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { name: 'hijacked' })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ name: 'Car B' })
  })

  it('update succeeds on the caller’s own tenant vehicle', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { name: 'Renamed A' })
    expect(updated).toMatchObject({ id: a.id, name: 'Renamed A' })
  })

  it('update ignores operatorId in the patch (cannot move a vehicle to another tenant)', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { operatorId: opB, name: 'moved' })
    expect(updated?.operatorId).toBe(opA)
    expect(updated?.name).toBe('moved')
  })

  it('softDelete cannot reach another tenant vehicle', async () => {
    const { repo, b } = await seed()
    expect(await repo.softDelete(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'AVAILABLE' })
  })

  it('bulkUpdateStatus skips another tenant vehicle', async () => {
    const { repo, b } = await seed()
    expect(await repo.bulkUpdateStatus(ctxFor(opA), [b.id], 'MAINTENANCE')).toEqual([])
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'AVAILABLE' })
  })

  it('appendPhotos reports not_found for another tenant vehicle', async () => {
    const { repo, b } = await seed()
    expect(await repo.appendPhotos(ctxFor(opA), b.id, ['https://img/x.jpg'], 10)).toEqual({
      outcome: 'not_found',
    })
  })

  it('removePhotoByUrl cannot reach another tenant vehicle', async () => {
    const { repo, b } = await seed()
    expect(
      await repo.removePhotoByUrl(ctxFor(opA), b.id, 'https://img/existing.jpg'),
    ).toBeUndefined()
  })

  it('a tenant-less operator fails closed on writes', async () => {
    const { repo, a } = await seed()
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    await expect(repo.update(noTenant, a.id, { name: 'x' })).rejects.toThrow(ForbiddenError)
  })
})
