import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicleBlocks } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupLocations,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #1101 slice 1: proves the DB-level guarantees of vehicle_blocks against REAL
// Postgres — the `vehicle_blocks_no_overlap` GiST EXCLUDE (block-vs-block) and the
// `vehicle_blocks_end_after_start` CHECK. These objects are snapshot-invisible
// (custom migration 0076), so only a real-pg test exercises them.

const vehicleRepo = new DrizzleVehicleRepository(db)

const T0 = new Date('2026-09-01T00:00:00Z')
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000)

let classId: string
let locationId: string
let vehicleA: string
let vehicleB: string
const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []
const createdBlockIds: string[] = []

async function insertBlock(overrides: {
  vehicleId: string
  startAt: Date
  endAt: Date
}): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(vehicleBlocks).values({
    id,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    vehicleId: overrides.vehicleId,
    startAt: overrides.startAt,
    endAt: overrides.endAt,
    kind: 'MAINTENANCE',
    reason: 'scheduled service',
    notes: null,
    createdBy: 'system',
  })
  createdBlockIds.push(id)
  return id
}

/** Captures the Postgres error a failing write throws. Drizzle + postgres-js
 * wraps the raw PostgresError under `err.cause`, so we read code/constraint via
 * the shared pg-errors helpers (which check both paths). */
async function captureError(
  fn: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await fn()
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraintName(err) }
  }
  throw new Error('expected the write to throw, but it succeeded')
}

beforeAll(async () => {
  const klass = await seedVehicleClass('block')
  classId = klass.id
  createdClassIds.push(klass.id)
  const location = await seedLocation('block')
  locationId = location.id
  createdLocationIds.push(location.id)

  const mk = (name: string): Promise<Vehicle> =>
    vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name,
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
    })
  vehicleA = (await mk('Block Car A')).id
  vehicleB = (await mk('Block Car B')).id
  createdVehicleIds.push(vehicleA, vehicleB)
})

afterEach(async () => {
  if (createdBlockIds.length > 0) {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.id, createdBlockIds))
    createdBlockIds.length = 0
  }
})

afterAll(async () => {
  await cleanupVehicles(createdVehicleIds)
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

describe('vehicle_blocks DB constraints', () => {
  it('accepts a well-formed block', async () => {
    const id = await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    expect(id).toMatch(/[0-9a-f-]{36}/)
  })

  it('rejects a second block overlapping the same vehicle (23P01 vehicle_blocks_no_overlap)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    const err = await captureError(() =>
      insertBlock({ vehicleId: vehicleA, startAt: hours(24), endAt: hours(72) }),
    )
    expect(err.code).toBe('23P01')
    expect(err.constraint).toBe('vehicle_blocks_no_overlap')
  })

  it('rejects endAt <= startAt (23514 vehicle_blocks_end_after_start)', async () => {
    const err = await captureError(() =>
      insertBlock({ vehicleId: vehicleA, startAt: hours(10), endAt: hours(10) }),
    )
    expect(err.code).toBe('23514')
    expect(err.constraint).toBe('vehicle_blocks_end_after_start')
  })

  it('allows back-to-back blocks (half-open [start,end) — adjacent does not overlap)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(24) })
    const id = await insertBlock({ vehicleId: vehicleA, startAt: hours(24), endAt: hours(48) })
    expect(id).toBeTruthy()
  })

  it('allows the same window on a different vehicle (key is per-vehicle)', async () => {
    await insertBlock({ vehicleId: vehicleA, startAt: hours(0), endAt: hours(48) })
    const id = await insertBlock({ vehicleId: vehicleB, startAt: hours(0), endAt: hours(48) })
    expect(id).toBeTruthy()
  })
})
