import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicles } from '@kuruma/shared/db/schema'
import { photoRefsToWireUrls, wireUrlsToStoredRefs } from '@kuruma/shared/lib/photo-ref'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, cleanupVehicleClasses, cleanupVehicles, db } from './setup'

// Mirror the composition root (#879): decode r2:<key> -> wire URL on read,
// encode wire URL -> r2:<key> on write, both bound to ONE public base. The
// repository is the single serialization boundary — stored rows carry r2: refs,
// the wire only ever sees URLs. These assertions read the RAW column to prove
// the encode actually lands an r2: ref (not just that read decode is a no-op).
const BASE = 'https://photos.test.example'
const decode = (photos: readonly string[]) => photoRefsToWireUrls(photos, BASE)
const encode = (photos: readonly string[]) => wireUrlsToStoredRefs(photos, BASE)
const repo = new DrizzleVehicleRepository(db, decode, encode)
const classRepo = new DrizzleVehicleClassRepository(db, decode, encode)

const vehicleIds: string[] = []
const classIds: string[] = []
afterEach(async () => {
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  vehicleIds.length = 0
  classIds.length = 0
})

function vehicleInput(photos: string[]) {
  return {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: 'Photo Ref Car',
    description: null,
    photos,
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE' as const,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  }
}

function classInput(photos: string[]) {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: `Photo Class ${uniq}`,
    slug: `photo-class-${uniq}`,
    description: null,
    photos,
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM' as const,
    transmission: 'AUTO' as const,
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE' as const,
  }
}

async function rawVehiclePhotos(id: string): Promise<string[]> {
  const [row] = await db
    .select({ photos: vehicles.photos })
    .from(vehicles)
    .where(eq(vehicles.id, id))
  return row?.photos ?? []
}

async function makeVehicle(photos: string[] = []): Promise<string> {
  const v = await repo.create(SYSTEM_CONTEXT, vehicleInput(photos))
  vehicleIds.push(v.id)
  return v.id
}

describe('DrizzleVehicleRepository photo ref encoding (#879 Slice 3)', () => {
  it('appendPhotos stores an r2 ref for our own URL and reads it back as a wire URL', async () => {
    const id = await makeVehicle([])
    const key = `vehicles/${id}/shot.jpg`
    const wireUrl = `${BASE}/${key}`

    const res = await repo.appendPhotos(SYSTEM_CONTEXT, id, [wireUrl], 10)

    expect(res.outcome).toBe('ok')
    expect(await rawVehiclePhotos(id)).toEqual([`r2:${key}`])
    const found = await repo.findById(SYSTEM_CONTEXT, id)
    expect(found?.photos).toEqual([wireUrl])
  })

  it('appendPhotos stores an external URL verbatim — never minted as r2', async () => {
    const id = await makeVehicle([])
    const ext = 'https://images.unsplash.com/photo-1734?w=800&q=80'

    await repo.appendPhotos(SYSTEM_CONTEXT, id, [ext], 10)

    expect(await rawVehiclePhotos(id)).toEqual([ext])
    const found = await repo.findById(SYSTEM_CONTEXT, id)
    expect(found?.photos).toEqual([ext])
  })

  it('create encodes a mixed photos array to stored refs and returns decoded URLs', async () => {
    const key = 'vehicles/seed/c.jpg'
    const ext = 'https://images.example/y.jpg'

    const v = await repo.create(SYSTEM_CONTEXT, vehicleInput([`${BASE}/${key}`, ext]))
    vehicleIds.push(v.id)

    expect(await rawVehiclePhotos(v.id)).toEqual([`r2:${key}`, ext])
    expect(v.photos).toEqual([`${BASE}/${key}`, ext])
  })

  it('update re-encodes a wire URL so an edit round-trip never bakes in the host', async () => {
    const id = await makeVehicle([])
    const key = `vehicles/${id}/d.jpg`

    const updated = await repo.update(SYSTEM_CONTEXT, id, { photos: [`${BASE}/${key}`] })

    expect(await rawVehiclePhotos(id)).toEqual([`r2:${key}`])
    expect(updated?.photos).toEqual([`${BASE}/${key}`])
  })

  it('removePhotoByUrl removes an r2-stored photo addressed by its wire URL (F1)', async () => {
    const id = await makeVehicle([])
    const key = `vehicles/${id}/e.jpg`
    const wireUrl = `${BASE}/${key}`
    await repo.appendPhotos(SYSTEM_CONTEXT, id, [wireUrl], 10)
    expect(await rawVehiclePhotos(id)).toEqual([`r2:${key}`])

    const removed = await repo.removePhotoByUrl(SYSTEM_CONTEXT, id, wireUrl)

    expect(removed).toBeDefined()
    expect(removed?.photos).toEqual([])
    expect(await rawVehiclePhotos(id)).toEqual([])
  })
})

describe('DrizzleVehicleClassRepository photo ref encoding (#879 Slice 3)', () => {
  async function rawClassPhotos(id: string): Promise<string[]> {
    const { vehicleClasses } = await import('@kuruma/shared/db/schema')
    const [row] = await db
      .select({ photos: vehicleClasses.photos })
      .from(vehicleClasses)
      .where(eq(vehicleClasses.id, id))
    return row?.photos ?? []
  }

  it('create encodes class photos to stored refs', async () => {
    const key = 'vehicles/class/a.jpg'
    const ext = 'https://images.example/z.jpg'

    const created = await classRepo.create(classInput([`${BASE}/${key}`, ext]))
    classIds.push(created.id)

    expect(await rawClassPhotos(created.id)).toEqual([`r2:${key}`, ext])
    expect(created.photos).toEqual([`${BASE}/${key}`, ext])
  })

  it('update re-encodes class photos', async () => {
    const created = await classRepo.create(classInput([]))
    classIds.push(created.id)
    const key = `vehicles/class/${created.id}.jpg`

    const updated = await classRepo.update(SYSTEM_CONTEXT, created.id, {
      photos: [`${BASE}/${key}`],
    })

    expect(await rawClassPhotos(created.id)).toEqual([`r2:${key}`])
    expect(updated?.photos).toEqual([`${BASE}/${key}`])
  })
})
