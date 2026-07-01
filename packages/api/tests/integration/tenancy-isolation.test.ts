import {
  addOnOptions,
  bookings,
  feeSchedules,
  insuranceOptions,
  operators,
  users,
  vehicleClasses,
  vehicles,
} from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAddOnRepository,
  DrizzleBookingRepository,
  DrizzleFeeScheduleRepository,
  DrizzleInsuranceOptionRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { VehicleClassService } from '../../src/services/vehicle-class'
import type { AddOn, FeeSchedule, InsuranceOption, Vehicle, VehicleClass } from '../../src/stores'
import { bookingInput } from '../helpers/booking'
import { DEFAULT_DAILY_RATE_JPY, cleanupLocations, db, seedLocation } from './setup'

// An OPERATOR_* caller scoped to one tenant must never observe another
// tenant's vehicles, and repos not yet operator-scoped in slice 1 (#386) must
// fail closed rather than leak across tenants. Exercised against real Postgres.

// #1205 slice 2 supersedes the fail-closed contract that thread/message repos
// used to enforce here (they rejected every OPERATOR_* caller). They are now
// operator-scoped via `threadReadScope`; the cross-tenant seal is proven in
// tests/integration/messaging-tenancy.test.ts (Drizzle) and the InMemory twin.

// Slice 6 (#392) supersedes the slice-1 fail-closed contract for BookingRepository:
// it is now operator-scoped (three-way bookingReadScope). Proven against real
// Postgres — an operator reads/writes only its own tenant, a tenant-less operator
// fails closed, and a cross-tenant write is a no-op (mirrors the tenancy-guards unit).
describe('booking repo is operator-scoped (Drizzle, real Postgres)', () => {
  const bookingRepo = new DrizzleBookingRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_bk_a_${uniq}`
  const opBId = `op_bk_b_${uniq}`
  const renterId = crypto.randomUUID()
  const createdLocationIds: string[] = []
  let classAId: string
  let vehicleAId: string
  let locationAId: string
  let bookingAId: string
  let bookingTripId: string

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  // operatorId belongs to A; an op-B caller passing this must be rejected before
  // any insert, so the FK ids only need to be well-formed (the create throws first).
  const foreignCreateInput = () =>
    bookingInput({
      operatorId: opAId,
      renterId,
      classId: classAId,
      requestedVehicleId: vehicleAId,
      assignedVehicleId: vehicleAId,
      pickupLocationId: locationAId,
      dropoffLocationId: locationAId,
      startAt: new Date('2027-09-02T10:00:00Z'),
      endAt: new Date('2027-09-02T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
    })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `bk-a-${uniq}`, name: 'Bk Operator A' },
      { id: opBId, slug: `bk-b-${uniq}`, name: 'Bk Operator B' },
    ])
    await db.insert(users).values({
      id: renterId,
      email: `bk-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    const classA = await classRepo.create({
      operatorId: opAId,
      name: `Bk Class ${uniq}`,
      slug: `bk-class-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    classAId = classA.id
    const location = await seedLocation('bk', 2880, opAId)
    locationAId = location.id
    createdLocationIds.push(location.id)
    const vehicleA = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opAId,
      classId: classAId,
      name: 'Bk Car A',
      description: null,
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    vehicleAId = vehicleA.id
    const bookingA = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: opAId,
        renterId,
        classId: classAId,
        requestedVehicleId: vehicleAId,
        assignedVehicleId: vehicleAId,
        pickupLocationId: locationAId,
        dropoffLocationId: locationAId,
        startAt: new Date('2027-09-01T10:00:00Z'),
        endAt: new Date('2027-09-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
      }),
    )
    bookingAId = bookingA.id
    // A Trip.com-sourced booking on the SAME operator, on the same car at a
    // non-overlapping time (so the exclusion constraint stays satisfied). A
    // PARTNER must see THIS one but not the DIRECT bookingA above (#1119).
    const bookingTrip = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: opAId,
        renterId,
        classId: classAId,
        requestedVehicleId: vehicleAId,
        assignedVehicleId: vehicleAId,
        pickupLocationId: locationAId,
        dropoffLocationId: locationAId,
        startAt: new Date('2027-09-05T10:00:00Z'),
        endAt: new Date('2027-09-05T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'TRIP_COM',
      }),
    )
    bookingTripId = bookingTrip.id
  })

  afterAll(async () => {
    await db.delete(bookings).where(eq(bookings.operatorId, opAId))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await cleanupLocations(createdLocationIds)
    await db.delete(users).where(inArray(users.id, [renterId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator reads only its own tenant bookings', async () => {
    const ownIds = (await bookingRepo.findAll(ctxFor(opAId))).map((b) => b.id)
    expect(ownIds).toContain(bookingAId)
    const foreignIds = (await bookingRepo.findAll(ctxFor(opBId))).map((b) => b.id)
    expect(foreignIds).not.toContain(bookingAId)
  })

  it('operator findById cannot reach another tenant booking', async () => {
    expect(await bookingRepo.findById(ctxFor(opAId), bookingAId)).toMatchObject({ id: bookingAId })
    expect(await bookingRepo.findById(ctxFor(opBId), bookingAId)).toBeUndefined()
  })

  // #1119: a Trip.com PARTNER key reads only its own channel (source=TRIP_COM),
  // never an operator's DIRECT booking — even though it bypasses scope elsewhere.
  const partnerCtx: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }

  it('a PARTNER reads its TRIP_COM booking but not the operator DIRECT booking', async () => {
    const ids = (await bookingRepo.findAll(partnerCtx)).map((b) => b.id)
    expect(ids).toContain(bookingTripId)
    expect(ids).not.toContain(bookingAId)
  })

  it('a PARTNER findById cannot reach a DIRECT booking', async () => {
    expect(await bookingRepo.findById(partnerCtx, bookingTripId)).toMatchObject({
      id: bookingTripId,
    })
    expect(await bookingRepo.findById(partnerCtx, bookingAId)).toBeUndefined()
  })

  it('operator cannot create a booking for another operator', async () => {
    await expect(bookingRepo.create(ctxFor(opBId), foreignCreateInput())).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('cross-tenant cancel is a no-op, leaving the booking CONFIRMED', async () => {
    const result = await bookingRepo.cancel(ctxFor(opBId), bookingAId, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
    })
    expect(result).toBeUndefined()
    expect((await bookingRepo.findById(ctxFor(opAId), bookingAId))?.status).toBe('CONFIRMED')
  })

  it('a tenant-less operator fails closed', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await bookingRepo.findAll(noTenant)).toHaveLength(0)
    expect(await bookingRepo.findById(noTenant, bookingAId)).toBeUndefined()
  })
})

describe('cross-operator vehicle isolation', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_iso_a_${uniq}`
  const opBId = `op_iso_b_${uniq}`
  const createdVehicleIds: string[] = []
  let vehicleA: Vehicle
  let vehicleB: Vehicle

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seedVehicle = (operatorId: string, name: string): Promise<Vehicle> =>
    vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId,
      classId: null,
      name,
      description: null,
      photos: [],
      seats: 5,
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
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `iso-a-${uniq}`, name: 'Iso Operator A' },
      { id: opBId, slug: `iso-b-${uniq}`, name: 'Iso Operator B' },
    ])
    vehicleA = await seedVehicle(opAId, 'Iso Car A')
    vehicleB = await seedVehicle(opBId, 'Iso Car B')
    createdVehicleIds.push(vehicleA.id, vehicleB.id)
  })

  afterAll(async () => {
    if (createdVehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('stamps the requested operatorId on each tenant write', () => {
    expect(vehicleA.operatorId).toBe(opAId)
    expect(vehicleB.operatorId).toBe(opBId)
  })

  it('findAll returns only the scoped tenant vehicles', async () => {
    const { data } = await vehicleRepo.findAll(ctxFor(opAId))
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehicleA.id)
    expect(ids).not.toContain(vehicleB.id)
    expect(data.every((v) => v.operatorId === opAId)).toBe(true)
  })

  it('findById cannot reach another tenant vehicle', async () => {
    const ctxA = ctxFor(opAId)
    expect(await vehicleRepo.findById(ctxA, vehicleA.id)).toMatchObject({ id: vehicleA.id })
    expect(await vehicleRepo.findById(ctxA, vehicleB.id)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    const { data } = await vehicleRepo.findAll(noTenant)
    expect(data).toHaveLength(0)
    expect(await vehicleRepo.findById(noTenant, vehicleA.id)).toBeUndefined()
  })

  // Writes are scoped at the repository, not just the route: an operator cannot
  // mutate another tenant's vehicle even by id (#386 F2). Run after the read
  // assertions above; the final case renames operator A's own vehicle.
  it('update cannot reach another tenant vehicle (no-op, not leak)', async () => {
    expect(
      await vehicleRepo.update(ctxFor(opAId), vehicleB.id, { name: 'hijacked' }),
    ).toBeUndefined()
    expect(await vehicleRepo.findById(SYSTEM_CONTEXT, vehicleB.id)).toMatchObject({
      name: 'Iso Car B',
    })
  })

  it('softDelete cannot reach another tenant vehicle', async () => {
    expect(await vehicleRepo.softDelete(ctxFor(opAId), vehicleB.id)).toBeUndefined()
    expect(await vehicleRepo.findById(SYSTEM_CONTEXT, vehicleB.id)).toMatchObject({
      status: 'AVAILABLE',
    })
  })

  it('bulkUpdateStatus skips another tenant vehicle', async () => {
    expect(await vehicleRepo.bulkUpdateStatus(ctxFor(opAId), [vehicleB.id], 'MAINTENANCE')).toEqual(
      [],
    )
  })

  it('an operator can update its own tenant vehicle', async () => {
    const updated = await vehicleRepo.update(ctxFor(opAId), vehicleA.id, { name: 'Iso Car A v2' })
    expect(updated).toMatchObject({ id: vehicleA.id, name: 'Iso Car A v2' })
  })
})

// Vehicle-class reads are operator-scoped (#395): an OPERATOR_* caller only
// sees its own tenant's classes; a tenant-less operator fails closed; admins
// (SYSTEM_CONTEXT) read across operators. Exercised against real Postgres.
describe('cross-operator class isolation', () => {
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_cls_a_${uniq}`
  const opBId = `op_cls_b_${uniq}`
  const createdClassIds: string[] = []
  let classA: VehicleClass
  let classB: VehicleClass

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seedClass = (operatorId: string, suffix: string): Promise<VehicleClass> =>
    classRepo.create({
      operatorId,
      name: `Iso Class ${suffix}`,
      slug: `iso-class-${suffix}-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `cls-a-${uniq}`, name: 'Class Operator A' },
      { id: opBId, slug: `cls-b-${uniq}`, name: 'Class Operator B' },
    ])
    classA = await seedClass(opAId, 'a')
    classB = await seedClass(opBId, 'b')
    createdClassIds.push(classA.id, classB.id)
  })

  afterAll(async () => {
    if (createdClassIds.length > 0) {
      await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, createdClassIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('findAll returns only the scoped tenant classes', async () => {
    const ids = (await classRepo.findAll(ctxFor(opAId))).map((c) => c.id)
    expect(ids).toContain(classA.id)
    expect(ids).not.toContain(classB.id)
  })

  it('findById cannot reach another tenant class', async () => {
    const ctxA = ctxFor(opAId)
    expect(await classRepo.findById(ctxA, classA.id)).toMatchObject({ id: classA.id })
    expect(await classRepo.findById(ctxA, classB.id)).toBeUndefined()
  })

  it('findBySlug cannot reach another tenant class', async () => {
    const ctxA = ctxFor(opAId)
    expect(await classRepo.findBySlug(ctxA, classA.slug)).toMatchObject({ id: classA.id })
    expect(await classRepo.findBySlug(ctxA, classB.slug)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await classRepo.findAll(noTenant)).toHaveLength(0)
    expect(await classRepo.findById(noTenant, classA.id)).toBeUndefined()
    expect(await classRepo.findBySlug(noTenant, classA.slug)).toBeUndefined()
  })

  it('SYSTEM_CONTEXT reads classes across operators', async () => {
    const ids = (await classRepo.findAll(SYSTEM_CONTEXT)).map((c) => c.id)
    expect(ids).toContain(classA.id)
    expect(ids).toContain(classB.id)
  })
})

// Composite FK seal (#395 Phase 2): a vehicle's classId must belong to the
// vehicle's own operator. Enforced at the DB by FK vehicles(operatorId,classId)
// -> vehicle_classes(operatorId,id). A NULL classId stays allowed (MATCH SIMPLE),
// so an unassigned vehicle is fine. Covers create AND update (reassign on edit).
describe('vehicle classId is sealed to the vehicle’s operator (composite FK)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_fk_a_${uniq}`
  const opBId = `op_fk_b_${uniq}`
  let classA: VehicleClass
  let classB: VehicleClass

  const makeClass = (operatorId: string, suffix: string): Promise<VehicleClass> =>
    classRepo.create({
      operatorId,
      name: `FK Class ${suffix}`,
      slug: `fk-class-${suffix}-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })

  const vehicleInput = (operatorId: string, classId: string | null) => ({
    operatorId,
    classId,
    name: 'FK Vehicle',
    description: null,
    photos: [] as string[],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE' as const,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `fk-a-${uniq}`, name: 'FK Operator A' },
      { id: opBId, slug: `fk-b-${uniq}`, name: 'FK Operator B' },
    ])
    classA = await makeClass(opAId, 'a')
    classB = await makeClass(opBId, 'b')
  })

  // Delete by operatorId so any vehicle created by a still-failing assertion
  // (cross-tenant rows that wrongly succeed before the FK lands) is also removed.
  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  // Anchor to the PG foreign_key_violation code so the test cannot pass on an
  // unrelated error (e.g. a future NOT NULL column) while the cross-tenant seal
  // silently breaks. drizzle's err.message is just the failed SQL; the real PG
  // code lives at err.cause.code — pgErrorCode() reads both paths.
  const PG_FK_VIOLATION = '23503'
  const violationCode = (p: Promise<unknown>): Promise<string | null> =>
    p.then(
      () => null,
      (err) => pgErrorCode(err),
    )

  it('create rejects a class owned by another operator', async () => {
    expect(
      await violationCode(vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, classB.id))),
    ).toBe(PG_FK_VIOLATION)
  })

  it('create accepts the operator’s own class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, classA.id))
    expect(v.classId).toBe(classA.id)
  })

  it('create accepts a null class (unassigned vehicle)', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    expect(v.classId).toBeNull()
  })

  it('update rejects reassigning to another operator’s class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    expect(
      await violationCode(vehicleRepo.update(SYSTEM_CONTEXT, v.id, { classId: classB.id })),
    ).toBe(PG_FK_VIOLATION)
  })

  it('update accepts reassigning to the operator’s own class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    const updated = await vehicleRepo.update(SYSTEM_CONTEXT, v.id, { classId: classA.id })
    expect(updated?.classId).toBe(classA.id)
  })
})

// #397 opens class writes to OPERATOR_* at the route. Class repo writes take no
// ctx (no repo-layer guard), so the tenant seal for class update/archive lives
// in VehicleClassService.{update,archive} via its caller-scoped findById. This
// probes that seal against real Postgres: if an operator could mutate another
// tenant's class, the service-layer boundary would be a real bypass and we'd
// need a repo-layer guard. It must resolve to 404, leaving the row untouched.
describe('cross-operator class WRITE denial (service seal, #397)', () => {
  const classRepo = new DrizzleVehicleClassRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const bookingRepo = new DrizzleBookingRepository(db)
  const service = new VehicleClassService(classRepo, vehicleRepo, bookingRepo, '')
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_clsw_a_${uniq}`
  const opBId = `op_clsw_b_${uniq}`
  const createdClassIds: string[] = []
  let classA: VehicleClass

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `clsw-a-${uniq}`, name: 'ClsW Operator A' },
      { id: opBId, slug: `clsw-b-${uniq}`, name: 'ClsW Operator B' },
    ])
    classA = await classRepo.create({
      operatorId: opAId,
      name: 'ClsW Class A',
      slug: `clsw-a-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    createdClassIds.push(classA.id)
  })

  afterAll(async () => {
    if (createdClassIds.length > 0) {
      await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, createdClassIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B cannot update operator A class (404, row untouched)', async () => {
    const res = await service.update(ctxFor(opBId), classA.id, { name: 'hijacked' })
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle class not found' })
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({
      name: 'ClsW Class A',
    })
  })

  it('operator B cannot archive operator A class (404, still ACTIVE)', async () => {
    const res = await service.archive(ctxFor(opBId), classA.id)
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own class', async () => {
    const res = await service.update(ctxFor(opAId), classA.id, { name: 'ClsW Class A v2' })
    expect(res).toMatchObject({ ok: true, vehicleClass: { name: 'ClsW Class A v2' } })
  })
})

// #1288: the repo update()/archive() scope their WHERE by tenant, so a caller
// reaching the repo WITHOUT the service's findById guard (the IDOR vector this
// closes) still can't mutate another operator's class. Probed directly at the
// repo against real Postgres: cross-tenant is a silent no-op (undefined), the
// own-tenant write still succeeds.
describe('class repo writes stay tenant-scoped when the service is bypassed (#1288)', () => {
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_clsws_a_${uniq}`
  const opBId = `op_clsws_b_${uniq}`
  const createdClassIds: string[] = []
  let classA: VehicleClass

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `clsws-a-${uniq}`, name: 'ClsWS Operator A' },
      { id: opBId, slug: `clsws-b-${uniq}`, name: 'ClsWS Operator B' },
    ])
    classA = await classRepo.create({
      operatorId: opAId,
      name: 'ClsWS Class A',
      slug: `clsws-a-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    createdClassIds.push(classA.id)
  })

  afterAll(async () => {
    if (createdClassIds.length > 0) {
      await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, createdClassIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B update() on operator A class is a no-op (undefined, row untouched)', async () => {
    expect(await classRepo.update(ctxFor(opBId), classA.id, { name: 'hijacked' })).toBeUndefined()
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({
      name: 'ClsWS Class A',
    })
  })

  it('operator B archive() on operator A class is a no-op (undefined, still ACTIVE)', async () => {
    expect(await classRepo.archive(ctxFor(opBId), classA.id)).toBeUndefined()
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own class at the repo (own-tenant still works)', async () => {
    const updated = await classRepo.update(ctxFor(opAId), classA.id, { name: 'ClsWS Class A v2' })
    expect(updated).toMatchObject({ id: classA.id, name: 'ClsWS Class A v2' })
  })
})

// #1288: fee schedules are PRIVATE config, so the repo write path both
// tenant-scopes the WHERE (cross-tenant = silent no-op) AND rejects RENTER/PARTNER
// via requireManagementRead (else operatorReadScope maps them to {kind:'all'} → an
// unscoped write of any operator's fees). Probed directly at the Drizzle repo
// against real Postgres, bypassing the service's findById guard.
describe('fee-schedule repo writes stay tenant-scoped + management-guarded when the service is bypassed (#1288)', () => {
  const feeRepo = new DrizzleFeeScheduleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_feews_a_${uniq}`
  const opBId = `op_feews_b_${uniq}`
  let feeA: FeeSchedule

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `feews-a-${uniq}`, name: 'FeeWS Operator A' },
      { id: opBId, slug: `feews-b-${uniq}`, name: 'FeeWS Operator B' },
    ])
    feeA = await feeRepo.create({
      operatorId: opAId,
      vehicleClassId: null,
      feeType: 'CLEANING_FLAT',
      unit: 'FLAT',
      amountJpy: 3000,
      status: 'ACTIVE',
    })
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B update() on operator A fee is a no-op (undefined, amount untouched)', async () => {
    expect(await feeRepo.update(ctxFor(opBId), feeA.id, { amountJpy: 9999 })).toBeUndefined()
    expect(await feeRepo.findById(SYSTEM_CONTEXT, feeA.id)).toMatchObject({ amountJpy: 3000 })
  })

  it('operator B archive() on operator A fee is a no-op (undefined, still ACTIVE)', async () => {
    expect(await feeRepo.archive(ctxFor(opBId), feeA.id)).toBeUndefined()
    expect(await feeRepo.findById(SYSTEM_CONTEXT, feeA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own fee at the repo (own-tenant still works)', async () => {
    const updated = await feeRepo.update(ctxFor(opAId), feeA.id, { amountJpy: 3500 })
    expect(updated).toMatchObject({ id: feeA.id, amountJpy: 3500 })
  })

  it('a RENTER write is Forbidden at the repo (private config, mirrors the read guard)', async () => {
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    await expect(feeRepo.update(renter, feeA.id, { amountJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(feeRepo.archive(renter, feeA.id)).rejects.toBeInstanceOf(ForbiddenError)
    // The renter's rejected write left the amount at the previous test's value.
    expect(await feeRepo.findById(SYSTEM_CONTEXT, feeA.id)).toMatchObject({ amountJpy: 3500 })
  })
})

// #1288: insurance options are PRIVATE config, same shape as fee schedules above
// — the repo write path tenant-scopes the WHERE AND management-guards RENTER/
// PARTNER. Probed directly at the Drizzle repo against real Postgres.
describe('insurance repo writes stay tenant-scoped + management-guarded when the service is bypassed (#1288)', () => {
  const insRepo = new DrizzleInsuranceOptionRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_insws_a_${uniq}`
  const opBId = `op_insws_b_${uniq}`
  let optionA: InsuranceOption

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `insws-a-${uniq}`, name: 'InsWS Operator A' },
      { id: opBId, slug: `insws-b-${uniq}`, name: 'InsWS Operator B' },
    ])
    optionA = await insRepo.create({
      operatorId: opAId,
      name: 'CDW',
      description: null,
      dailyPriceJpy: 1500,
      deductibleJpy: 150000,
      status: 'ACTIVE',
    })
  })

  afterAll(async () => {
    await db.delete(insuranceOptions).where(inArray(insuranceOptions.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B update() on operator A option is a no-op (undefined, price untouched)', async () => {
    expect(await insRepo.update(ctxFor(opBId), optionA.id, { dailyPriceJpy: 9999 })).toBeUndefined()
    expect(await insRepo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({
      dailyPriceJpy: 1500,
    })
  })

  it('operator B archive() on operator A option is a no-op (undefined, still ACTIVE)', async () => {
    expect(await insRepo.archive(ctxFor(opBId), optionA.id)).toBeUndefined()
    expect(await insRepo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own option at the repo (own-tenant still works)', async () => {
    const updated = await insRepo.update(ctxFor(opAId), optionA.id, { dailyPriceJpy: 2000 })
    expect(updated).toMatchObject({ id: optionA.id, dailyPriceJpy: 2000 })
  })

  it('a RENTER write is Forbidden at the repo (private config, mirrors the read guard)', async () => {
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    await expect(insRepo.update(renter, optionA.id, { dailyPriceJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(insRepo.archive(renter, optionA.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await insRepo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({
      dailyPriceJpy: 2000,
    })
  })
})

// #1288: add-ons are PRIVATE config, same shape as fee/insurance above — the repo
// write path tenant-scopes the WHERE AND management-guards RENTER/PARTNER. Probed
// directly at the Drizzle repo against real Postgres.
describe('add-on repo writes stay tenant-scoped + management-guarded when the service is bypassed (#1288)', () => {
  const addOnRepo = new DrizzleAddOnRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_aows_a_${uniq}`
  const opBId = `op_aows_b_${uniq}`
  let addOnA: AddOn

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `aows-a-${uniq}`, name: 'AOWS Operator A' },
      { id: opBId, slug: `aows-b-${uniq}`, name: 'AOWS Operator B' },
    ])
    addOnA = await addOnRepo.create({
      operatorId: opAId,
      name: 'Baby Seat',
      description: null,
      priceJpy: 1500,
      status: 'ACTIVE',
    })
  })

  afterAll(async () => {
    await db.delete(addOnOptions).where(inArray(addOnOptions.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B update() on operator A add-on is a no-op (undefined, price untouched)', async () => {
    expect(await addOnRepo.update(ctxFor(opBId), addOnA.id, { priceJpy: 9999 })).toBeUndefined()
    expect(await addOnRepo.findById(SYSTEM_CONTEXT, addOnA.id)).toMatchObject({ priceJpy: 1500 })
  })

  it('operator B archive() on operator A add-on is a no-op (undefined, still ACTIVE)', async () => {
    expect(await addOnRepo.archive(ctxFor(opBId), addOnA.id)).toBeUndefined()
    expect(await addOnRepo.findById(SYSTEM_CONTEXT, addOnA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own add-on at the repo (own-tenant still works)', async () => {
    const updated = await addOnRepo.update(ctxFor(opAId), addOnA.id, { priceJpy: 2000 })
    expect(updated).toMatchObject({ id: addOnA.id, priceJpy: 2000 })
  })

  it('a RENTER write is Forbidden at the repo (private config, mirrors the read guard)', async () => {
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    await expect(addOnRepo.update(renter, addOnA.id, { priceJpy: 1 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(addOnRepo.archive(renter, addOnA.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await addOnRepo.findById(SYSTEM_CONTEXT, addOnA.id)).toMatchObject({ priceJpy: 2000 })
  })
})
