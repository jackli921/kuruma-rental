import { bookings, operators, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleFleetOverviewRepository,
  DrizzleOverviewRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { bookingInput } from '../helpers/booking'
import { DEFAULT_DAILY_RATE_JPY, cleanupLocations, db, seedLocation } from './setup'

// #594: the operator portal Fleet page reads GET /vehicles/fleet-overview, so
// the aggregated read MUST be tenant-scoped at the repository (the production
// Drizzle path — the in-memory repo is only the behaviour spec). An OPERATOR_*
// caller sees ONLY its own vehicles and only bookings on those vehicles; a
// tenant-less operator fails closed; bypass roles (SYSTEM_CONTEXT) see all.
// Exercised against real Postgres so a wrong SQL predicate cannot pass silently.
describe('fleet-overview is operator-scoped (Drizzle, real Postgres)', () => {
  const fleetRepo = new DrizzleFleetOverviewRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const classRepo = new DrizzleVehicleClassRepository(db)
  const bookingRepo = new DrizzleBookingRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_fo_a_${uniq}`
  const opBId = `op_fo_b_${uniq}`
  const renterId = crypto.randomUUID()
  const createdLocationIds: string[] = []
  // Booking sits 5 days before NOW, squarely inside the 30-day utilization window.
  const NOW = new Date('2027-09-10T12:00:00Z')
  let vehicleAId: string
  let vehicleBId: string
  let retiredVehicleAId: string

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  // Seed one tenant: class -> location -> vehicle -> one CONFIRMED booking on it.
  async function seedTenant(operatorId: string, prefix: string): Promise<string> {
    const cls = await classRepo.create({
      operatorId,
      name: `FO Class ${prefix}-${uniq}`,
      slug: `fo-class-${prefix}-${uniq}`,
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
    const loc = await seedLocation(`fo-${prefix}`, 2880, operatorId)
    createdLocationIds.push(loc.id)
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId,
      classId: cls.id,
      name: `FO Car ${prefix}`,
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
    await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId,
        renterId,
        classId: cls.id,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
        pickupLocationId: loc.id,
        dropoffLocationId: loc.id,
        startAt: new Date('2027-09-05T10:00:00Z'),
        endAt: new Date('2027-09-05T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
      }),
    )
    return vehicle.id
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `fo-a-${uniq}`, name: 'FO Operator A' },
      { id: opBId, slug: `fo-b-${uniq}`, name: 'FO Operator B' },
    ])
    await db.insert(users).values({
      id: renterId,
      email: `fo-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    vehicleAId = await seedTenant(opAId, 'a')
    vehicleBId = await seedTenant(opBId, 'b')
    // A RETIRED car for operator A (#600): the overview must still surface it.
    // classId null is fine — vehicles.classId is nullable (unassigned vehicle).
    const retired = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opAId,
      classId: null,
      name: `FO Retired ${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'RETIRED',
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
    retiredVehicleAId = retired.id
  })

  afterAll(async () => {
    await db.delete(bookings).where(inArray(bookings.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await cleanupLocations(createdLocationIds)
    await db.delete(users).where(inArray(users.id, [renterId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an operator sees only its own vehicles', async () => {
    const ids = (await fleetRepo.findFleetOverview(ctxFor(opAId), NOW)).map((r) => r.id)
    expect(ids).toContain(vehicleAId)
    expect(ids).not.toContain(vehicleBId)
  })

  it('every overview row belongs to the caller’s tenant', async () => {
    const rows = await fleetRepo.findFleetOverview(ctxFor(opBId), NOW)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.operatorId === opBId)).toBe(true)
  })

  it('counts only bookings on the caller’s own vehicles', async () => {
    const rows = await fleetRepo.findFleetOverview(ctxFor(opAId), NOW)
    const own = rows.find((r) => r.id === vehicleAId)
    expect(own?.bookingCountLast30Days).toBe(1)
    // Operator B's vehicle (and therefore its booking) never appears for A.
    expect(rows.some((r) => r.id === vehicleBId)).toBe(false)
  })

  it('a tenant-less operator sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await fleetRepo.findFleetOverview(noTenant, NOW)).toEqual([])
  })

  it('SYSTEM_CONTEXT (bypass) sees both operators’ vehicles', async () => {
    const ids = (await fleetRepo.findFleetOverview(SYSTEM_CONTEXT, NOW)).map((r) => r.id)
    expect(ids).toContain(vehicleAId)
    expect(ids).toContain(vehicleBId)
  })

  // #1273: legacy STAFF/ADMIN resolve to `renter` under bookingReadScope, so the
  // fleet card must read nothing — matching the overview card and the #487
  // phase-out. Before the fix this SQL path used operatorReadScope (legacy ->
  // `all`) and leaked the whole fleet; asserted against real Postgres.
  it('a legacy STAFF/ADMIN sees nothing — parity with overview + in-memory', async () => {
    const staff: CallerContext = { userId: 'legacy', role: 'STAFF', bypassScope: false }
    const admin: CallerContext = { userId: 'legacy', role: 'ADMIN', bypassScope: false }
    expect(await fleetRepo.findFleetOverview(staff, NOW)).toEqual([])
    expect(await fleetRepo.findFleetOverview(admin, NOW)).toEqual([])
  })

  it('includes the operator’s RETIRED vehicles (#600 — parity with in-memory)', async () => {
    const rows = await fleetRepo.findFleetOverview(ctxFor(opAId), NOW)
    const retired = rows.find((r) => r.id === retiredVehicleAId)
    expect(retired).toBeDefined()
    expect(retired!.status).toBe('RETIRED')
  })

  // #407 slice 4: the operator-context picker's bypass narrowing, exercised
  // against real SQL so a wrong WHERE predicate cannot pass silently.
  it('narrows a bypass caller to the picked operator (WHERE operatorId)', async () => {
    const ids = (await fleetRepo.findFleetOverview(SYSTEM_CONTEXT, NOW, opAId)).map((r) => r.id)
    expect(ids).toContain(vehicleAId)
    expect(ids).not.toContain(vehicleBId)
  })

  it('ignores a foreign operatorId for a tenant caller (no cross-tenant widening)', async () => {
    const rows = await fleetRepo.findFleetOverview(ctxFor(opBId), NOW, opAId)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.operatorId === opBId)).toBe(true)
  })

  // Dashboard overview counts share the picker's bypass narrowing. Asserted
  // against the same seeded tenants so a wrong count predicate cannot pass.
  describe('dashboard overview narrowing (Drizzle, real Postgres)', () => {
    const overviewRepo = new DrizzleOverviewRepository(db)

    it('a bypass caller narrowed to an operator matches that operator’s own counts', async () => {
      const aScoped = await overviewRepo.getOperatorOverview(ctxFor(opAId), NOW)
      const bypassNarrowed = await overviewRepo.getOperatorOverview(SYSTEM_CONTEXT, NOW, opAId)
      expect(bypassNarrowed).toEqual(aScoped)
    })

    it('a tenant caller ignores a foreign operatorId (counts unchanged)', async () => {
      const bScoped = await overviewRepo.getOperatorOverview(ctxFor(opBId), NOW)
      const bWithForeign = await overviewRepo.getOperatorOverview(ctxFor(opBId), NOW, opAId)
      expect(bWithForeign).toEqual(bScoped)
    })
  })
})
