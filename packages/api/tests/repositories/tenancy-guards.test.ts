import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryAddOnRepository } from '../../src/repositories/in-memory/add-on'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryFeeScheduleRepository } from '../../src/repositories/in-memory/fee-schedule'
import { InMemoryInsuranceOptionRepository } from '../../src/repositories/in-memory/insurance-option'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory/location'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory/vehicle-class'
import type { Vehicle } from '../../src/stores'
import { bookingInput } from '../helpers/booking'

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

// Thread/Message repositories became operator-scoped in #1205 slice 2 (the
// `threadReadScope` replacing the old `rejectOperatorContextUntilScoped` gate).
// The cross-tenant scoping contract now lives in messaging-tenancy.test.ts (and
// the operator-unread counter in operator-unread.test.ts), so the obsolete
// "rejects OPERATOR_* until scoped" blocks were removed here.

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

// LocationRepository scopes writes too (#1288): update/archive tenant-scope their
// WHERE AND call requireFleetWriteScope(ctx), mirroring vehicle.ts. location is a
// public-READ catalog, so the write path uses the WRITE guard (not the read
// guard): a non-fleet-write role (RENTER/PARTNER) or a tenant-less operator is
// rejected with ForbiddenError (fail closed). A cross-tenant id is a silent
// no-op, never a leak. (The private-config repos below differ: they gate reads
// AND writes with requireManagementRead and no-op for a tenant-less operator.)
describe('LocationRepository operator-scopes writes (#1288)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
  const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
  const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }

  const locationInput = (operatorId: string, name: string) => ({
    operatorId,
    name,
    address: '1-2-3 Test',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE' as const,
  })

  const seed = async () => {
    const repo = new InMemoryLocationRepository()
    const a = await repo.create(locationInput(opA, 'A-Namba'))
    const b = await repo.create(locationInput(opB, 'B-Umeda'))
    return { repo, a, b }
  }

  it('update cannot reach another tenant location (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { name: 'hijacked' })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ name: 'B-Umeda' })
  })

  it('update succeeds on the caller’s own tenant location', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { defaultTurnaroundMinutes: 3600 })
    expect(updated).toMatchObject({ id: a.id, defaultTurnaroundMinutes: 3600 })
  })

  it('archive cannot reach another tenant location (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.archive(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('archive succeeds on the caller’s own tenant location', async () => {
    const { repo, a } = await seed()
    expect(await repo.archive(ctxFor(opA), a.id)).toMatchObject({ id: a.id, status: 'ARCHIVED' })
  })

  it('a tenant-less operator is Forbidden (fail closed via requireFleetWriteScope)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(noTenant, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(noTenant, a.id)).rejects.toBeInstanceOf(ForbiddenError)
    // Row untouched: no rename, still ACTIVE.
    expect(await repo.findById(SYSTEM_CONTEXT, a.id)).toMatchObject({
      name: 'A-Namba',
      status: 'ACTIVE',
    })
  })

  it('RENTER writes are Forbidden (fleet-write guard, mirrors vehicle.ts)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(renter, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(renter, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER writes are Forbidden (fleet-write guard, mirrors vehicle.ts)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(partner, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(partner, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// VehicleClassRepository scopes writes too (#1288), same public-catalog shape as
// LocationRepository above: cross-tenant update/archive is a silent no-op, and
// the write path calls requireFleetWriteScope (RENTER/PARTNER + tenant-less
// operator rejected with ForbiddenError). vehicle_class is the FK parent of the
// fee-schedule composite FK, so its tenant is doubly load-bearing — the #1279
// operatorId strip and this #1288 WHERE-scope + fleet-write guard stack.
describe('VehicleClassRepository operator-scopes writes (#1288)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
  const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
  const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }

  const classInput = (operatorId: string, slug: string) => ({
    operatorId,
    name: 'Compact',
    slug,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM' as const,
    transmission: 'AUTO' as const,
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE' as const,
  })

  const seed = async () => {
    const repo = new InMemoryVehicleClassRepository()
    const a = await repo.create(classInput(opA, 'compact-a'))
    const b = await repo.create(classInput(opB, 'compact-b'))
    return { repo, a, b }
  }

  it('update cannot reach another tenant class (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { name: 'hijacked' })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ name: 'Compact' })
  })

  it('update succeeds on the caller’s own tenant class', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { seats: 7 })
    expect(updated).toMatchObject({ id: a.id, seats: 7 })
  })

  it('archive cannot reach another tenant class (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.archive(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('archive succeeds on the caller’s own tenant class', async () => {
    const { repo, a } = await seed()
    expect(await repo.archive(ctxFor(opA), a.id)).toMatchObject({ id: a.id, status: 'ARCHIVED' })
  })

  it('a tenant-less operator is Forbidden (fail closed via requireFleetWriteScope)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(noTenant, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(noTenant, a.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await repo.findById(SYSTEM_CONTEXT, a.id)).toMatchObject({
      name: 'Compact',
      status: 'ACTIVE',
    })
  })

  it('RENTER writes are Forbidden (fleet-write guard, mirrors vehicle.ts)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(renter, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(renter, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER writes are Forbidden (fleet-write guard, mirrors vehicle.ts)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(partner, a.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(partner, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// FeeScheduleRepository is PRIVATE config (unlike the public location/class
// catalog): its reads already reject RENTER/PARTNER via requireManagementRead.
// #1288 mirrors that on the WRITE path — update/archive reject RENTER/PARTNER
// (else operatorReadScope maps them to {kind:'all'} → an unscoped write of any
// operator's private fees) AND tenant-scope the row. So a service-bypassing
// caller can neither cross tenants nor write private config as a renter.
describe('FeeScheduleRepository operator-scopes + management-guards writes (#1288)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
  const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
  const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }

  const feeInput = (operatorId: string) => ({
    operatorId,
    vehicleClassId: null,
    feeType: 'CLEANING_FLAT' as const,
    unit: 'FLAT' as const,
    amountJpy: 2000,
    status: 'ACTIVE' as const,
  })

  const seed = async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const a = await repo.create(feeInput(opA))
    const b = await repo.create(feeInput(opB))
    return { repo, a, b }
  }

  it('update cannot reach another tenant fee (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { amountJpy: 9999 })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ amountJpy: 2000 })
  })

  it('update succeeds on the caller’s own tenant fee', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { amountJpy: 3600 })
    expect(updated).toMatchObject({ id: a.id, amountJpy: 3600 })
  })

  it('archive cannot reach another tenant fee (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.archive(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('archive succeeds on the caller’s own tenant fee', async () => {
    const { repo, a } = await seed()
    expect(await repo.archive(ctxFor(opA), a.id)).toMatchObject({ id: a.id, status: 'ARCHIVED' })
  })

  it('a tenant-less operator no-ops writes (config repo has no write guard)', async () => {
    const { repo, a } = await seed()
    expect(await repo.update(noTenant, a.id, { amountJpy: 1 })).toBeUndefined()
    expect(await repo.archive(noTenant, a.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, a.id)).toMatchObject({
      amountJpy: 2000,
      status: 'ACTIVE',
    })
  })

  it('RENTER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(renter, a.id, { amountJpy: 1 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(renter, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(partner, a.id, { amountJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(repo.archive(partner, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// InsuranceOptionRepository is PRIVATE config too (#1288): update/archive reject
// RENTER/PARTNER (else operatorReadScope maps them to {kind:'all'} → unscoped)
// AND tenant-scope the row — same shape as FeeScheduleRepository above.
describe('InsuranceOptionRepository operator-scopes + management-guards writes (#1288)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
  const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
  const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }

  const optionInput = (operatorId: string) => ({
    operatorId,
    name: 'CDW',
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: 150000,
    status: 'ACTIVE' as const,
  })

  const seed = async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const a = await repo.create(optionInput(opA))
    const b = await repo.create(optionInput(opB))
    return { repo, a, b }
  }

  it('update cannot reach another tenant option (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { dailyPriceJpy: 9999 })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ dailyPriceJpy: 1500 })
  })

  it('update succeeds on the caller’s own tenant option', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { dailyPriceJpy: 2600 })
    expect(updated).toMatchObject({ id: a.id, dailyPriceJpy: 2600 })
  })

  it('archive cannot reach another tenant option (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.archive(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('archive succeeds on the caller’s own tenant option', async () => {
    const { repo, a } = await seed()
    expect(await repo.archive(ctxFor(opA), a.id)).toMatchObject({ id: a.id, status: 'ARCHIVED' })
  })

  it('a tenant-less operator no-ops writes (config repo has no write guard)', async () => {
    const { repo, a } = await seed()
    expect(await repo.update(noTenant, a.id, { dailyPriceJpy: 1 })).toBeUndefined()
    expect(await repo.archive(noTenant, a.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, a.id)).toMatchObject({
      dailyPriceJpy: 1500,
      status: 'ACTIVE',
    })
  })

  it('RENTER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(renter, a.id, { dailyPriceJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(repo.archive(renter, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(partner, a.id, { dailyPriceJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(repo.archive(partner, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// AddOnRepository is PRIVATE config too (#1288): update/archive reject RENTER/
// PARTNER (else operatorReadScope maps them to {kind:'all'} → unscoped) AND
// tenant-scope the row — same shape as Fee/Insurance above.
describe('AddOnRepository operator-scopes + management-guards writes (#1288)', () => {
  const opA = 'op_a'
  const opB = 'op_b'
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })
  const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
  const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
  const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }

  const addOnInput = (operatorId: string) => ({
    operatorId,
    name: 'Baby Seat',
    description: null,
    priceJpy: 1500,
    status: 'ACTIVE' as const,
  })

  const seed = async () => {
    const repo = new InMemoryAddOnRepository()
    const a = await repo.create(addOnInput(opA))
    const b = await repo.create(addOnInput(opB))
    return { repo, a, b }
  }

  it('update cannot reach another tenant add-on (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.update(ctxFor(opA), b.id, { priceJpy: 9999 })).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ priceJpy: 1500 })
  })

  it('update succeeds on the caller’s own tenant add-on', async () => {
    const { repo, a } = await seed()
    const updated = await repo.update(ctxFor(opA), a.id, { priceJpy: 2600 })
    expect(updated).toMatchObject({ id: a.id, priceJpy: 2600 })
  })

  it('archive cannot reach another tenant add-on (no-op, not leak)', async () => {
    const { repo, b } = await seed()
    expect(await repo.archive(ctxFor(opA), b.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, b.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('archive succeeds on the caller’s own tenant add-on', async () => {
    const { repo, a } = await seed()
    expect(await repo.archive(ctxFor(opA), a.id)).toMatchObject({ id: a.id, status: 'ARCHIVED' })
  })

  it('a tenant-less operator no-ops writes (config repo has no write guard)', async () => {
    const { repo, a } = await seed()
    expect(await repo.update(noTenant, a.id, { priceJpy: 1 })).toBeUndefined()
    expect(await repo.archive(noTenant, a.id)).toBeUndefined()
    expect(await repo.findById(SYSTEM_CONTEXT, a.id)).toMatchObject({
      priceJpy: 1500,
      status: 'ACTIVE',
    })
  })

  it('RENTER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(renter, a.id, { priceJpy: 1 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(renter, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER writes are Forbidden (private config, mirrors the read guard)', async () => {
    const { repo, a } = await seed()
    await expect(repo.update(partner, a.id, { priceJpy: 1 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(repo.archive(partner, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
