import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryMessageRepository } from '../../src/repositories/in-memory/message'
import { InMemoryThreadRepository } from '../../src/repositories/in-memory/thread'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import type { Vehicle } from '../../src/stores'

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
