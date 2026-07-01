import { complianceAlertLog, operators, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleComplianceAlertLogRepository,
  DrizzleOperatorRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { OperatorSummaryService } from '../../src/services/operator-summary'
import type { Vehicle } from '../../src/stores'
import { bookingInput } from '../helpers/booking'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupBookings,
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
} from './setup'

// #1120: prove the per-operator summary's three Drizzle reads over REAL Postgres.
// The InMemory doubles pin the bucketing/ordering contract; ONLY this proves the
// live SQL — `count(*) filter (where …)` for the compliance + booking roll-ups and
// `max(sent_at)` for the last alert — round-trips through the neon driver with the
// right types (e.g. max() returns a Date, not a string). All reads are
// operator-scoped, so a fresh operator keeps every assertion deterministic on a
// shared DB.
//
// asOf straddles the UTC->JST date line: 2026-06-27T16:00Z is 2026-06-28T01:00 JST,
// so jstDateString(asOf) = 2026-06-28. A vehicle whose shaken expires 2026-06-27 is
// EXPIRED under the JST date but in-date under the UTC date — proving the SQL
// classifies on the JST boundary, not naive UTC.
const ASOF = new Date('2026-06-27T16:00:00Z')

const operatorRepo = new DrizzleOperatorRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const alertRepo = new DrizzleComplianceAlertLogRepository(db)
const service = new OperatorSummaryService(
  operatorRepo,
  vehicleRepo,
  bookingRepo,
  alertRepo,
  () => ASOF,
)

const uniq = (p: string): string => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function seedClass(operatorId: string): Promise<string> {
  const slug = uniq('class-summary')
  const [row] = await db
    .insert(vehicleClasses)
    .values({
      id: crypto.randomUUID(),
      operatorId,
      name: `Class ${slug}`,
      slug,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    .returning({ id: vehicleClasses.id })
  if (!row) throw new Error('failed to seed class')
  return row.id
}

function makeVehicle(
  operatorId: string,
  classId: string,
  over: Partial<Vehicle>,
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId,
    classId,
    name: `Car ${uniq('v')}`,
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
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
    ...over,
  })
}

let operatorId: string
let operatorName: string
let renterId: string
const vehicleIds: string[] = []
const bookingIds: string[] = []
let classId: string
let locationId: string

beforeAll(async () => {
  const op = await operatorRepo.create({
    name: `Summary ${uniq('op')}`,
    slug: uniq('summary'),
    preAuthHandoffUrl: null,
  })
  operatorId = op.id
  operatorName = op.name

  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `${uniq('renter')}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning({ id: users.id })
  if (!user) throw new Error('failed to seed renter')
  renterId = user.id

  classId = await seedClass(operatorId)
  const location = await seedLocation('summary', 2880, operatorId)
  locationId = location.id

  // 4 live vehicles spanning each compliance bucket + 1 RETIRED (excluded).
  const vBoundary = await makeVehicle(operatorId, classId, { shakenExpiryDate: '2026-06-27' }) // EXPIRED under JST 2026-06-28
  const vUnknown = await makeVehicle(operatorId, classId, { shakenExpiryDate: null }) // UNKNOWN
  const vSoon = await makeVehicle(operatorId, classId, { shakenExpiryDate: '2026-07-10' }) // EXPIRING_SOON (<= 2026-07-28)
  const vFine = await makeVehicle(operatorId, classId, {}) // both 2027-01-01 → fine
  const vRetired = await makeVehicle(operatorId, classId, {
    status: 'RETIRED',
    shakenExpiryDate: null,
  })
  vehicleIds.push(vBoundary.id, vUnknown.id, vSoon.id, vFine.id, vRetired.id)

  // Bookings — one per vehicle so the GiST exclusion never fires. Counts:
  // total = non-CANCELLED = 3; upcoming = (CONFIRMED|ACTIVE) & startAt >= ASOF = 2.
  const win = (vehicleId: string, startIso: string) => ({
    operatorId,
    renterId,
    classId,
    requestedVehicleId: vehicleId,
    assignedVehicleId: vehicleId,
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    startAt: new Date(startIso),
    endAt: new Date(new Date(startIso).getTime() + 6 * 60 * 60 * 1000),
  })
  const made = await Promise.all([
    bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...win(vBoundary.id, '2026-08-01T09:00:00Z'), status: 'CONFIRMED' }),
    ),
    bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...win(vUnknown.id, '2026-09-01T09:00:00Z'), status: 'ACTIVE' }),
    ),
    bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...win(vSoon.id, '2026-05-01T09:00:00Z'), status: 'COMPLETED' }),
    ),
    bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...win(vFine.id, '2026-08-15T09:00:00Z'), status: 'CANCELLED' }),
    ),
  ])
  bookingIds.push(...made.map((b) => b.id))

  // Two distinct alert bands on one vehicle so the band-unique seal holds; the
  // newer sentAt is what latestSentAtForOperator must surface.
  await db.insert(complianceAlertLog).values([
    {
      id: crypto.randomUUID(),
      operatorId,
      vehicleId: vBoundary.id,
      documentType: 'SHAKEN',
      thresholdBand: 'D30',
      recipient: 'owner@op.example',
      sentAt: new Date('2026-06-01T00:00:00Z'),
    },
    {
      id: crypto.randomUUID(),
      operatorId,
      vehicleId: vBoundary.id,
      documentType: 'SHAKEN',
      thresholdBand: 'D14',
      recipient: 'owner@op.example',
      sentAt: new Date('2026-06-20T09:30:00Z'),
    },
  ])
})

afterAll(async () => {
  await cleanupBookings(bookingIds)
  await cleanupVehicles(vehicleIds) // compliance_alert_log cascades on vehicleId
  await cleanupVehicleClasses([classId])
  await cleanupLocations([locationId])
  await cleanupUsers([renterId])
  if (operatorId) await db.delete(operators).where(eq(operators.id, operatorId))
})

describe('per-operator summary over real Postgres (#1120)', () => {
  it('countComplianceForOperator buckets the live fleet, classifying on the JST date', async () => {
    const counts = await vehicleRepo.countComplianceForOperator(operatorId, ASOF)
    // 5 vehicles seeded, 1 RETIRED excluded → 4 live. needingDocs = JST-expired +
    // unknown = 2; expiringSoon = 1; the fine vehicle counts toward neither.
    expect(counts).toEqual({ total: 4, needingDocs: 2, expiringSoon: 1 })
  })

  it('countBookingsForOperator excludes CANCELLED and counts only future CONFIRMED/ACTIVE as upcoming', async () => {
    const counts = await bookingRepo.countBookingsForOperator(operatorId, ASOF)
    expect(counts).toEqual({ total: 3, upcoming: 2 })
  })

  it('latestSentAtForOperator returns the newest sentAt as a Date', async () => {
    const latest = await alertRepo.latestSentAtForOperator(operatorId)
    expect(latest).toBeInstanceOf(Date)
    expect(latest?.getTime()).toBe(new Date('2026-06-20T09:30:00Z').getTime())
  })

  it('latestSentAtForOperator returns null for an operator that was never alerted', async () => {
    expect(await alertRepo.latestSentAtForOperator(crypto.randomUUID())).toBeNull()
  })

  it('OperatorSummaryService composes the full roll-up from the live SQL reads', async () => {
    const summary = await service.getSummary(
      { userId: SYSTEM_CONTEXT.userId, role: 'PLATFORM_ADMIN' },
      operatorId,
    )
    expect(summary).toEqual({
      operatorId,
      name: operatorName,
      vehicleCount: 4,
      vehiclesNeedingDocs: 2,
      vehiclesExpiringSoon: 1,
      totalBookings: 3,
      upcomingBookings: 2,
      lastComplianceAlertAt: '2026-06-20T09:30:00.000Z',
    })
  })
})
