import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleBookingRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
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
  seedVehicleClass,
} from './setup'

// #851 Slice 3 (real pg): the cancel tx writes the initial settlement state in the
// SAME UPDATE as status + fee. The InMemory twin (booking.test.ts) proves the money
// policy that picks the state; ONLY this proves the new Drizzle column write persists
// each enum value — and that an omitted settlement still defaults to the legacy
// 'ADVISORY' (so every pre-#851 cancel caller is unchanged).

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let userId: string
let vehicleId: string
const classIds: string[] = []
const locationIds: string[] = []
const vehicleIds: string[] = []
const bookingIds: string[] = []

let startSeq = 0
// Each cancel test needs its own CONFIRMED booking on a non-overlapping range so the
// exclusion constraint never clashes; the sequence pushes each a month further out.
async function seedConfirmed(): Promise<string> {
  startSeq += 1
  const start = new Date(Date.UTC(2027, startSeq, 1, 9))
  const end = new Date(Date.UTC(2027, startSeq, 2, 9))
  const b = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: userId,
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      pickupLocationId: locationIds[0]!,
      dropoffLocationId: locationIds[0]!,
      startAt: start,
      endAt: end,
    }),
  )
  bookingIds.push(b.id)
  return b.id
}

const settlementInDb = async (id: string): Promise<string | undefined> => {
  const [row] = await db
    .select({ s: bookings.cancellationFeeSettlement })
    .from(bookings)
    .where(eq(bookings.id, id))
  return row?.s
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `cancel-settle-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  userId = user.id

  const klass = await seedVehicleClass('cancelsettle')
  classIds.push(klass.id)
  const location = await seedLocation('cancelsettle')
  locationIds.push(location.id)
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: klass.id,
    name: 'Cancel Settlement Car',
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
  vehicleId = vehicle.id
  vehicleIds.push(vehicle.id)
})

afterAll(async () => {
  await cleanupBookings(bookingIds)
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  await cleanupLocations(locationIds)
  await cleanupUsers([userId])
})

describe('DrizzleBookingRepository.cancel — settlement column (#851 Slice 3, real pg)', () => {
  it('persists REFUND_DUE written atomically with the cancel (paid, refundable tier)', async () => {
    const id = await seedConfirmed()
    const cancelled = await bookingRepo.cancel(SYSTEM_CONTEXT, id, {
      from: 'CONFIRMED',
      fee: 6_000,
      cancelledAt: new Date(),
      settlement: 'REFUND_DUE',
    })
    expect(cancelled?.cancellationFeeSettlement).toBe('REFUND_DUE')
    expect(await settlementInDb(id)).toBe('REFUND_DUE')
  })

  it('persists CAPTURED for a paid full-tier cancel (whole payment kept)', async () => {
    const id = await seedConfirmed()
    await bookingRepo.cancel(SYSTEM_CONTEXT, id, {
      from: 'CONFIRMED',
      fee: 20_000,
      cancelledAt: new Date(),
      settlement: 'CAPTURED',
    })
    expect(await settlementInDb(id)).toBe('CAPTURED')
  })

  it('defaults an omitted settlement to ADVISORY (legacy cancel callers unchanged)', async () => {
    const id = await seedConfirmed()
    await bookingRepo.cancel(SYSTEM_CONTEXT, id, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
    })
    expect(await settlementInDb(id)).toBe('ADVISORY')
  })
})
