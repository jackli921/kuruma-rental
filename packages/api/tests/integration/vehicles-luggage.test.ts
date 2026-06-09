import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, cleanupVehicles, db } from './setup'

// #457: vehicles.luggageCapacity + vehicles.luggageSize are NULLABLE per-vehicle
// overrides (null → fall back to the class default). The Drizzle create allowlist
// and the vehicleColumns projection list columns explicitly, so an override is
// silently dropped (persists null) if either omits luggage. Only a real INSERT
// exercises the allowlist; in-memory repos spread `...data` and can't catch it.
const repo = new DrizzleVehicleRepository(db)
const createdIds: string[] = []

afterEach(async () => {
  await cleanupVehicles(createdIds)
  createdIds.length = 0
})

function vehicleInput(luggageCapacity: number | null, luggageSize: LuggageSize | null) {
  return {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: 'Luggage Test Vehicle',
    description: null,
    seats: 5,
    luggageCapacity,
    luggageSize,
    transmission: 'AUTO' as const,
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE' as const,
    minRentalHours: 4,
    maxRentalHours: 72,
    advanceBookingHours: 24,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  }
}

describe('DrizzleVehicleRepository luggage override (#457)', () => {
  it('create persists a per-vehicle luggage override (allowlist guard)', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, vehicleInput(4, 'LARGE'))
    createdIds.push(created.id)
    expect(created.luggageCapacity).toBe(4)
    expect(created.luggageSize).toBe('LARGE')
  })

  it('findById round-trips the override (projection guard)', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, vehicleInput(1, 'SMALL'))
    createdIds.push(created.id)

    const fetched = await repo.findById(SYSTEM_CONTEXT, created.id)
    expect(fetched?.luggageCapacity).toBe(1)
    expect(fetched?.luggageSize).toBe('SMALL')
  })

  it('create stores null when no override is given (falls back to class later)', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, vehicleInput(null, null))
    createdIds.push(created.id)
    expect(created.luggageCapacity).toBeNull()
    expect(created.luggageSize).toBeNull()
  })

  // Plan P1: clearing an override (PATCH null) must persist null so the read path
  // falls back to the class default — not silently keep the old override.
  it('update clears a per-vehicle override back to null', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, vehicleInput(4, 'LARGE'))
    createdIds.push(created.id)

    await repo.update(SYSTEM_CONTEXT, created.id, { luggageCapacity: null, luggageSize: null })

    const fetched = await repo.findById(SYSTEM_CONTEXT, created.id)
    expect(fetched?.luggageCapacity).toBeNull()
    expect(fetched?.luggageSize).toBeNull()
  })
})
