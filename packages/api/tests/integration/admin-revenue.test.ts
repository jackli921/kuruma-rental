import { operators, paymentEvents, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { computePlatformCommission } from '@kuruma/shared/lib/commission'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleOperatorRepository,
  DrizzlePaymentEventRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { AdminRevenueService } from '../../src/services/admin-revenue'
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

// #825: prove the #462 admin-revenue aggregation over REAL Postgres. The route
// test (tests/routes/admin-revenue.test.ts) only exercises in-memory repos, and
// payment-events.test.ts asserts row constraints — neither proves the live SQL
// path: `listSucceeded(month)`'s `AT TIME ZONE 'Asia/Tokyo'` filter, the DISTINCT
// `listSucceededMonths`, and `operators.list()` feeding the pure aggregator with
// REAL driver rows (integer columns, timestamptz round-trip) rather than mocks.
//
// `operators.list()` and `listSucceeded()` are cross-tenant by design, so a
// shared test DB carries the global-setup Best Car Rental operator plus whatever
// parallel files seed. We therefore create TWO fresh operators and scope every
// assertion to THEIR ids — per-partner subtotals, month rows, and the month
// filter are all deterministic; only the global grand totals are not.
const operatorRepo = new DrizzleOperatorRepository(db)
const paymentRepo = new DrizzlePaymentEventRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const service = new AdminRevenueService(paymentRepo, operatorRepo)

// Two distinct JST payout months. The first instant straddles the UTC->JST date
// line (15:30 UTC on Apr 30 is 00:30 JST on May 1) so the SQL `AT TIME ZONE`
// boundary is exercised, not just a mid-month instant.
const MAY_2026 = new Date('2026-04-30T15:30:00Z') // 2026-05-01T00:30 JST -> month 2026-05
const JUN_2026 = new Date('2026-06-15T03:00:00Z') // 2026-06-15 in both UTC and JST -> 2026-06

// Gross amounts chosen so each partner's per-month subtotal is an exact, unique
// figure and the cross-partner gross ordering (biggest first) is unambiguous.
// computePlatformCommission gives the 4% fee + net, kept in lockstep with the row.
const RIVER_MAY = 100_000
const RIVER_JUN = 50_000
const SUMMIT_MAY = 30_000

const uniq = (p: string): string => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// vehicles reference vehicle_classes by the composite key (operatorId, id), so a
// class must be owned by the SAME operator as its vehicles. The shared
// seedVehicleClass helper hardcodes Best Car Rental's id (vehicle_classes is not
// yet operator-scoped at the API, #386), so seed the class directly here scoped
// to our fresh operator. Mirrors setup.ts otherwise.
async function seedClassForOperator(operatorId: string, prefix: string): Promise<string> {
  const slug = uniq(`class-${prefix}`)
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
  if (!row) throw new Error('Failed to seed vehicle class')
  return row.id
}

interface SeededOperator {
  id: string
  name: string
  slug: string
  userId: string
  classIds: string[]
  locationIds: string[]
  vehicleIds: string[]
  bookingIds: string[]
}

const seeded: SeededOperator[] = []

// Seed one partner's full FK graph (operator -> renter, class, location) plus one
// booking + one SUCCEEDED payment_events row per amount. Each payment needs its
// own booking because of the partial `one_success_per_booking` unique seal.
async function seedPartner(
  namePrefix: string,
  payments: ReadonlyArray<{ grossJpy: number; createdAt: Date }>,
): Promise<SeededOperator> {
  const op = await operatorRepo.create({
    name: `${namePrefix} ${uniq('op')}`,
    slug: uniq(namePrefix.toLowerCase()),
    preAuthHandoffUrl: null,
  })

  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `${uniq('renter')}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  if (!user) throw new Error('Failed to seed renter')

  const classId = await seedClassForOperator(op.id, namePrefix)
  // locations seal to the booking's operator too (locations_operatorId_id_unique).
  const location = await seedLocation(`rev-${namePrefix}`, 2880, op.id)

  const acc: SeededOperator = {
    id: op.id,
    name: op.name,
    slug: op.slug,
    userId: user.id,
    classIds: [classId],
    locationIds: [location.id],
    vehicleIds: [],
    bookingIds: [],
  }

  let monthSeq = 0
  for (const p of payments) {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: op.id,
      classId,
      name: `${namePrefix} Car ${acc.vehicleIds.length}`,
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
    acc.vehicleIds.push(vehicle.id)

    // Non-overlapping window per vehicle so the exclusion constraint never fires.
    const dayBase = new Date('2027-01-01T09:00:00Z')
    const start = new Date(dayBase.getTime() + monthSeq * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 6 * 60 * 60 * 1000)
    monthSeq += 1
    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: op.id,
        renterId: user.id,
        classId,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
        pickupLocationId: location.id,
        dropoffLocationId: location.id,
        startAt: start,
        endAt: end,
      }),
    )
    acc.bookingIds.push(booking.id)

    const { platformFeeJpy, netToPartnerJpy } = computePlatformCommission(p.grossJpy)
    // Insert directly so we control createdAt (the JST payout month under test).
    await db.insert(paymentEvents).values({
      operatorId: op.id,
      bookingId: booking.id,
      stripeEventId: uniq('evt'),
      stripeCheckoutSessionId: uniq('cs'),
      stripePaymentIntentId: uniq('pi'),
      grossJpy: p.grossJpy,
      platformFeeJpy,
      netToPartnerJpy,
      currency: 'jpy',
      status: 'SUCCEEDED',
      createdAt: p.createdAt,
    })
  }
  return acc
}

let river: SeededOperator
let summit: SeededOperator

beforeAll(async () => {
  // River: two months (May 100k + Jun 50k). Summit: one month (May 30k).
  river = await seedPartner('River', [
    { grossJpy: RIVER_MAY, createdAt: MAY_2026 },
    { grossJpy: RIVER_JUN, createdAt: JUN_2026 },
  ])
  summit = await seedPartner('Summit', [{ grossJpy: SUMMIT_MAY, createdAt: MAY_2026 }])
  seeded.push(river, summit)
})

afterAll(async () => {
  const operatorIds = seeded.map((s) => s.id)
  // onDelete:'restrict' on payment_events.operatorId -> delete payments first.
  if (operatorIds.length > 0) {
    await db.delete(paymentEvents).where(inArray(paymentEvents.operatorId, operatorIds))
  }
  for (const s of seeded) {
    await cleanupBookings(s.bookingIds)
    await cleanupVehicles(s.vehicleIds)
    await cleanupVehicleClasses(s.classIds)
    await cleanupLocations(s.locationIds)
    await cleanupUsers([s.userId])
  }
  if (operatorIds.length > 0) {
    await db.delete(operators).where(inArray(operators.id, operatorIds))
  }
})

// The report is cross-tenant; scope to our two seeded partners for deterministic
// assertions on a shared DB.
function mine(partners: AdminRevenueReportPartners): MinePartners {
  const byId = new Map(partners.map((p) => [p.operatorId, p]))
  return { river: byId.get(river.id), summit: byId.get(summit.id), all: partners }
}
type AdminRevenueReportPartners = Awaited<ReturnType<AdminRevenueService['getReport']>>['partners']
type MinePartners = {
  river: AdminRevenueReportPartners[number] | undefined
  summit: AdminRevenueReportPartners[number] | undefined
  all: AdminRevenueReportPartners
}

describe('AdminRevenueService over real Postgres (#825 / #462)', () => {
  it('aggregates gross / 4% fee / net per partner, bucketed by JST month', async () => {
    const report = await service.getReport(SYSTEM_CONTEXT)
    const { river: r, summit: s } = mine(report.partners)

    // River subtotal = May 100k + Jun 50k = 150k; fee = 4% = 6k; net = 144k.
    expect(r).toMatchObject({
      operatorId: river.id,
      operatorName: river.name,
      operatorSlug: river.slug,
      grossJpy: 150_000,
      platformFeeJpy: 6_000,
      netToPartnerJpy: 144_000,
      paymentCount: 2,
    })
    // Per-month rows, newest first, each carrying the exact yen for that month.
    expect(r?.months).toEqual([
      {
        month: '2026-06',
        grossJpy: 50_000,
        platformFeeJpy: 2_000,
        netToPartnerJpy: 48_000,
        paymentCount: 1,
      },
      {
        month: '2026-05',
        grossJpy: 100_000,
        platformFeeJpy: 4_000,
        netToPartnerJpy: 96_000,
        paymentCount: 1,
      },
    ])

    // Summit: single May payment of 30k; fee 1.2k; net 28.8k.
    expect(s).toMatchObject({
      operatorId: summit.id,
      operatorName: summit.name,
      operatorSlug: summit.slug,
      grossJpy: 30_000,
      platformFeeJpy: 1_200,
      netToPartnerJpy: 28_800,
      paymentCount: 1,
    })
    expect(s?.months).toEqual([
      {
        month: '2026-05',
        grossJpy: 30_000,
        platformFeeJpy: 1_200,
        netToPartnerJpy: 28_800,
        paymentCount: 1,
      },
    ])
  })

  it('SQL `AT TIME ZONE` buckets the UTC->JST straddling instant into its JST month', async () => {
    // 2026-04-30T15:30:00Z is 2026-05-01T00:30 JST. listSucceeded(month) filters on
    // `to_char(createdAt AT TIME ZONE 'Asia/Tokyo')` IN SQL, so this proves the boundary
    // at the DB layer (not just the JS aggregator's re-bucketing): River's 100k row must
    // surface under 2026-05, be absent from 2026-04, and never leak into 2026-06.
    const may = await paymentRepo.listSucceeded('2026-05')
    expect(may.some((p) => p.operatorId === river.id && p.grossJpy === 100_000)).toBe(true)

    const apr = await paymentRepo.listSucceeded('2026-04')
    expect(apr.some((p) => p.operatorId === river.id)).toBe(false)

    const jun = await paymentRepo.listSucceeded('2026-06')
    expect(jun.some((p) => p.operatorId === river.id && p.grossJpy === 50_000)).toBe(true)
    expect(jun.some((p) => p.operatorId === river.id && p.grossJpy === 100_000)).toBe(false)
  })

  it('orders our partners biggest gross first (River 150k before Summit 30k)', async () => {
    const report = await service.getReport(SYSTEM_CONTEXT)
    const ours = report.partners
      .map((p) => p.operatorId)
      .filter((id) => id === river.id || id === summit.id)
    expect(ours).toEqual([river.id, summit.id])
  })

  it('surfaces both seeded JST months in availableMonths (newest first)', async () => {
    const report = await service.getReport(SYSTEM_CONTEXT)
    const ours = report.availableMonths.filter((m) => m === '2026-06' || m === '2026-05')
    expect(ours).toEqual(['2026-06', '2026-05'])
    expect(report.selectedMonth).toBeNull()
  })

  it('?month=2026-06 narrows to River’s June payment only (Summit drops out)', async () => {
    const report = await service.getReport(SYSTEM_CONTEXT, '2026-06')
    const { river: r, summit: s, all } = mine(report.partners)

    expect(report.selectedMonth).toBe('2026-06')
    // Summit has no June payment -> absent from the scoped report.
    expect(s).toBeUndefined()
    expect(all.some((p) => p.operatorId === summit.id)).toBe(false)

    // River collapses to just its June row (50k gross / 2k fee / 48k net).
    expect(r).toMatchObject({
      grossJpy: 50_000,
      platformFeeJpy: 2_000,
      netToPartnerJpy: 48_000,
      paymentCount: 1,
    })
    expect(r?.months).toEqual([
      {
        month: '2026-06',
        grossJpy: 50_000,
        platformFeeJpy: 2_000,
        netToPartnerJpy: 48_000,
        paymentCount: 1,
      },
    ])
    // availableMonths stays the full set even while filtered (picker independence).
    expect(report.availableMonths.filter((m) => m === '2026-06' || m === '2026-05')).toEqual([
      '2026-06',
      '2026-05',
    ])
  })

  it('?month=2026-05 narrows to the May payments of BOTH partners', async () => {
    const report = await service.getReport(SYSTEM_CONTEXT, '2026-05')
    const { river: r, summit: s } = mine(report.partners)

    expect(report.selectedMonth).toBe('2026-05')
    // River's June row is excluded; only the 100k May row remains.
    expect(r).toMatchObject({
      grossJpy: 100_000,
      platformFeeJpy: 4_000,
      netToPartnerJpy: 96_000,
      paymentCount: 1,
    })
    expect(r?.months).toEqual([
      {
        month: '2026-05',
        grossJpy: 100_000,
        platformFeeJpy: 4_000,
        netToPartnerJpy: 96_000,
        paymentCount: 1,
      },
    ])
    expect(s).toMatchObject({
      grossJpy: 30_000,
      platformFeeJpy: 1_200,
      netToPartnerJpy: 28_800,
      paymentCount: 1,
    })
  })
})
