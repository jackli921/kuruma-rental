import { backfillVehicleExpiry } from '@kuruma/shared/db/backfill-vehicle-expiry'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicles } from '@kuruma/shared/db/schema'
import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, cleanupVehicles, db } from './setup'

// The backfill scans EVERY vehicle row, so assertions are PER ROW (like the
// #879 photo-ref backfill) — global counts would race with parallel files.
const repo = new DrizzleVehicleRepository(db)

const vehicleIds: string[] = []
afterEach(async () => {
  await cleanupVehicles(vehicleIds)
  vehicleIds.length = 0
})

async function seedVehicle(
  shakenExpiryDate: string | null,
  insuranceExpiryDate: string | null,
): Promise<string> {
  const v = await repo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: 'Expiry Backfill Car',
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
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate,
    insuranceExpiryDate,
  })
  vehicleIds.push(v.id)
  return v.id
}

async function readDocs(
  id: string,
): Promise<{ shakenExpiryDate: string | null; insuranceExpiryDate: string | null }> {
  const [row] = await db
    .select({
      shakenExpiryDate: vehicles.shakenExpiryDate,
      insuranceExpiryDate: vehicles.insuranceExpiryDate,
    })
    .from(vehicles)
    .where(eq(vehicles.id, id))
  if (!row) throw new Error(`vehicle ${id} not found`)
  return row
}

describe('vehicle-expiry backfill (#991)', () => {
  it('stamps NULL docs into road-legal future dates, leaving current and lapsed rows untouched', async () => {
    const today = jstDateString(new Date())
    const nullId = await seedVehicle(null, null)
    const currentId = await seedVehicle('2099-01-01', '2099-06-01')
    const lapsedId = await seedVehicle('2020-01-01', '2020-06-01')

    await backfillVehicleExpiry(db)

    // NULL row is now road-legal as of today (the gate would show it).
    const stamped = await readDocs(nullId)
    expect(stamped.shakenExpiryDate).not.toBeNull()
    expect(stamped.insuranceExpiryDate).not.toBeNull()
    expect(stamped.shakenExpiryDate! > today).toBe(true)
    expect(stamped.insuranceExpiryDate! > today).toBe(true)
    expect(isRoadLegal(stamped, today)).toBe(true)

    // Already-current row is preserved byte-for-byte (not re-stamped).
    expect(await readDocs(currentId)).toEqual({
      shakenExpiryDate: '2099-01-01',
      insuranceExpiryDate: '2099-06-01',
    })

    // Lapsed row is LEFT non-compliant — genuinely expired, surfaced by digest.
    expect(await readDocs(lapsedId)).toEqual({
      shakenExpiryDate: '2020-01-01',
      insuranceExpiryDate: '2020-06-01',
    })
  })

  it('is idempotent — a second run does not change an already-stamped row', async () => {
    const id = await seedVehicle(null, null)

    await backfillVehicleExpiry(db)
    const afterFirst = await readDocs(id)
    await backfillVehicleExpiry(db)
    const afterSecond = await readDocs(id)

    expect(afterFirst.shakenExpiryDate).not.toBeNull()
    expect(afterSecond).toEqual(afterFirst)
  })

  it('dry run reports the NULL rows it would stamp without writing', async () => {
    const id = await seedVehicle(null, null)

    const report = await backfillVehicleExpiry(db, { dryRun: true })

    expect(report.shakenStamped).toBeGreaterThanOrEqual(1)
    expect(report.insuranceStamped).toBeGreaterThanOrEqual(1)
    // No write happened — the row is still NULL (and still hidden by the gate).
    expect(await readDocs(id)).toEqual({ shakenExpiryDate: null, insuranceExpiryDate: null })
  })
})
