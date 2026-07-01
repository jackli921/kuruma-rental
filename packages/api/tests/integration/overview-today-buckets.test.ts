import { bookings, operators, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleOverviewRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { bookingInput } from '../helpers/booking'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupLocations,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// The #1102 today buckets against real Postgres so a wrong SQL predicate (JST
// window bound, endAt-vs-effectiveEndAt, disjoint returns/overdue, the renter
// LEFT JOIN) cannot pass silently. NOW = 14:00 JST on 2027-09-10; its JST day is
// [2027-09-09T15:00Z, 2027-09-10T15:00Z).
describe('DrizzleOverviewRepository today buckets (real Postgres)', () => {
  const overviewRepo = new DrizzleOverviewRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const bookingRepo = new DrizzleBookingRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_tb_a_${uniq}`
  const opBId = `op_tb_b_${uniq}`
  const renterId = crypto.randomUUID()
  const NOW = new Date('2027-09-10T05:00:00.000Z')
  const createdLocationIds: string[] = []
  const code = (name: string) => `TB-${name}-${uniq}`

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  async function seedVehicle(operatorId: string, classId: string, locId: string): Promise<string> {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId,
      classId,
      pickupLocationId: locId,
      name: `TB Car ${crypto.randomUUID().slice(0, 6)}`,
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
    return v.id
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `tb-a-${uniq}`, name: 'TB Operator A' },
      { id: opBId, slug: `tb-b-${uniq}`, name: 'TB Operator B' },
    ])
    await db.insert(users).values({
      id: renterId,
      email: `tb-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
      name: 'Alice Tester',
    })
    const clsA = await seedVehicleClass('tb-a', opAId)
    const clsB = await seedVehicleClass('tb-b', opBId)
    const locA = await seedLocation('tb-a', 2880, opAId)
    const locB = await seedLocation('tb-b', 2880, opBId)
    createdLocationIds.push(locA.id, locB.id)

    const mk = async (
      operatorId: string,
      classId: string,
      locId: string,
      overrides: Parameters<typeof bookingInput>[0],
    ) => {
      const vId = await seedVehicle(operatorId, classId, locId)
      await bookingRepo.create(
        SYSTEM_CONTEXT,
        bookingInput({
          operatorId,
          renterId,
          classId,
          requestedVehicleId: vId,
          assignedVehicleId: vId,
          pickupLocationId: locId,
          dropoffLocationId: locId,
          source: 'DIRECT',
          ...overrides,
        }),
      )
      return vId
    }

    // pickup: CONFIRMED, starts today (JST).
    await mk(opAId, clsA.id, locA.id, {
      bookingCode: code('PICK'),
      status: 'CONFIRMED',
      startAt: new Date('2027-09-10T01:00:00Z'),
      endAt: new Date('2027-09-10T09:00:00Z'),
    })
    // return: ACTIVE, due later today (endAt >= NOW).
    await mk(opAId, clsA.id, locA.id, {
      bookingCode: code('RET'),
      status: 'ACTIVE',
      startAt: new Date('2027-09-08T00:00:00Z'),
      endAt: new Date('2027-09-10T09:00:00Z'),
    })
    // overdue: ACTIVE, contractual endAt already past — even though the
    // effectiveEndAt turnaround tail is in the future. Must be OVERDUE, not return.
    await mk(opAId, clsA.id, locA.id, {
      bookingCode: code('OD'),
      status: 'ACTIVE',
      startAt: new Date('2027-09-05T00:00:00Z'),
      endAt: new Date('2027-09-08T00:00:00Z'),
      effectiveEndAt: new Date('2027-09-12T00:00:00Z'),
    })
    // future CONFIRMED: in no today bucket.
    await mk(opAId, clsA.id, locA.id, {
      bookingCode: code('FUTURE'),
      status: 'CONFIRMED',
      startAt: new Date('2027-09-20T01:00:00Z'),
      endAt: new Date('2027-09-20T09:00:00Z'),
    })
    // operator B pickup today: must never surface for operator A.
    await mk(opBId, clsB.id, locB.id, {
      bookingCode: code('OPB'),
      status: 'CONFIRMED',
      startAt: new Date('2027-09-10T01:00:00Z'),
      endAt: new Date('2027-09-10T09:00:00Z'),
    })
  })

  afterAll(async () => {
    await db.delete(bookings).where(inArray(bookings.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await cleanupLocations(createdLocationIds)
    await db.delete(users).where(inArray(users.id, [renterId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('buckets each of today’s pickups / returns / overdue correctly', async () => {
    const { today } = await overviewRepo.getOperatorOverview(ctxFor(opAId), NOW)
    expect(today.pickups.map((r) => r.bookingCode)).toEqual([code('PICK')])
    expect(today.returns.map((r) => r.bookingCode)).toEqual([code('RET')])
    expect(today.overdue.map((r) => r.bookingCode)).toEqual([code('OD')])
  })

  it('the overdue row carries the LEFT-JOINed renter name and ISO dates', async () => {
    const { today } = await overviewRepo.getOperatorOverview(ctxFor(opAId), NOW)
    const od = today.overdue[0]
    expect(od).toMatchObject({
      bookingCode: code('OD'),
      status: 'ACTIVE',
      renterName: 'Alice Tester',
      endAt: '2027-09-08T00:00:00.000Z',
    })
    expect(od?.vehicleId).toMatch(/./)
  })

  it('scopes to the caller — operator A never sees operator B’s pickup', async () => {
    const { today } = await overviewRepo.getOperatorOverview(ctxFor(opAId), NOW)
    const allCodes = [...today.pickups, ...today.returns, ...today.overdue].map(
      (r) => r.bookingCode,
    )
    expect(allCodes).not.toContain(code('OPB'))
  })

  it('bypass (SYSTEM_CONTEXT) sees operator B’s pickup across tenants', async () => {
    const { today } = await overviewRepo.getOperatorOverview(SYSTEM_CONTEXT, NOW)
    expect(today.pickups.map((r) => r.bookingCode)).toContain(code('OPB'))
  })
})
