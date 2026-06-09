import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleClassRepository } from '../../src/repositories/drizzle'
import { cleanupVehicleClasses, db } from './setup'

// #457: vehicle_classes.luggageSize is NOT NULL DEFAULT 'MEDIUM'. The Drizzle
// create allowlist (.values({})) and the vehicleClassColumns projection both
// list columns explicitly, so a non-default size silently reverts to 'MEDIUM'
// if either omits luggageSize. In-memory repos spread `...data` and cannot catch
// that drop — only a real INSERT does. Guards both the write and the read path.
const repo = new DrizzleVehicleClassRepository(db)
const createdIds: string[] = []

afterEach(async () => {
  await cleanupVehicleClasses(createdIds)
  createdIds.length = 0
})

function classInput(luggageSize: LuggageSize) {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: `Luggage ${uniq}`,
    slug: `luggage-${uniq}`,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 3,
    luggageSize,
    transmission: 'AUTO' as const,
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE' as const,
  }
}

describe('DrizzleVehicleClassRepository luggageSize (#457)', () => {
  it('create persists a non-default luggageSize (allowlist guard)', async () => {
    const created = await repo.create(classInput('LARGE'))
    createdIds.push(created.id)
    expect(created.luggageSize).toBe('LARGE')
  })

  it('findById returns the persisted luggageSize (projection guard)', async () => {
    const created = await repo.create(classInput('SMALL'))
    createdIds.push(created.id)

    const fetched = await repo.findById(SYSTEM_CONTEXT, created.id)
    expect(fetched?.luggageSize).toBe('SMALL')
  })
})
