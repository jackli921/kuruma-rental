import { backfillPhotoRefs } from '@kuruma/shared/db/backfill-photo-refs'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, cleanupVehicleClasses, cleanupVehicles, db } from './setup'

// A base unique to this file so the global backfill (it scans EVERY row) can be
// asserted PER ROW without colliding with other concurrent integration files.
const BASE = 'https://photos.backfill.example'

// IDENTITY encoder (no 3rd ctor arg) => seed LEGACY rows that store wire URLs
// verbatim — the pre-#879-Slice-3 state the backfill must migrate.
const legacyRepo = new DrizzleVehicleRepository(db)
const legacyClassRepo = new DrizzleVehicleClassRepository(db)

const vehicleIds: string[] = []
const classIds: string[] = []
afterEach(async () => {
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  vehicleIds.length = 0
  classIds.length = 0
})

async function rawVehiclePhotos(id: string): Promise<string[]> {
  const [row] = await db
    .select({ photos: vehicles.photos })
    .from(vehicles)
    .where(eq(vehicles.id, id))
  return row?.photos ?? []
}

async function rawClassPhotos(id: string): Promise<string[]> {
  const [row] = await db
    .select({ photos: vehicleClasses.photos })
    .from(vehicleClasses)
    .where(eq(vehicleClasses.id, id))
  return row?.photos ?? []
}

async function seedVehicle(photos: string[]): Promise<string> {
  const v = await legacyRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: 'Backfill Car',
    description: null,
    photos,
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
  vehicleIds.push(v.id)
  return v.id
}

async function seedClass(photos: string[]): Promise<string> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const c = await legacyClassRepo.create({
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: `Backfill Class ${uniq}`,
    slug: `backfill-class-${uniq}`,
    description: null,
    photos,
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
  })
  classIds.push(c.id)
  return c.id
}

describe('photo-ref backfill (#879 Slice 4)', () => {
  it('rewrites our own wire URLs to r2 refs, leaving externals and existing refs untouched', async () => {
    const ext = 'https://images.example/external.jpg'
    const vId = await seedVehicle([`${BASE}/vehicles/v/a.jpg`, ext, 'r2:vehicles/v/already.jpg'])
    const cId = await seedClass([`${BASE}/vehicles/class/c.jpg`, ext])

    const report = await backfillPhotoRefs(db, BASE)

    expect(report.vehiclesRewritten).toBeGreaterThanOrEqual(1)
    expect(report.vehicleClassesRewritten).toBeGreaterThanOrEqual(1)
    expect(await rawVehiclePhotos(vId)).toEqual([
      'r2:vehicles/v/a.jpg',
      ext,
      'r2:vehicles/v/already.jpg',
    ])
    expect(await rawClassPhotos(cId)).toEqual(['r2:vehicles/class/c.jpg', ext])
  })

  it('is idempotent — a row with no wire URLs of ours is left byte-for-byte unchanged', async () => {
    const ext = 'https://images.example/only-external.jpg'
    const vId = await seedVehicle([ext, 'r2:vehicles/v/keep.jpg'])

    const before = await rawVehiclePhotos(vId)
    await backfillPhotoRefs(db, BASE)
    const afterFirst = await rawVehiclePhotos(vId)
    await backfillPhotoRefs(db, BASE)
    const afterSecond = await rawVehiclePhotos(vId)

    expect(afterFirst).toEqual(before)
    expect(afterSecond).toEqual(before)
  })
})
