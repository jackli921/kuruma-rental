// Integration tests for the pricing fields on DrizzleVehicleRepository
// (issue #48). Proves round-trip of dailyRateJpy + hourlyRateJpy, that the
// database CHECK constraints reject invalid writes, and that an update
// cannot clear both rates.
//
// Run locally:
//   docker run -d --rm --name kuruma-pricing-pg \
//     -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma \
//     -e POSTGRES_DB=kuruma_test -p 5432:5432 postgres:16
//   DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test bun run db:migrate
//   cd packages/api && DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test \
//     bun run test:integration

import { afterEach, describe, expect, it } from 'vitest'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { cleanupVehicles, testDb } from './vehicles-setup'

const repo = new DrizzleVehicleRepository(testDb as unknown as Db)

const createdVehicleIds: string[] = []

afterEach(async () => {
  await cleanupVehicles(createdVehicleIds)
  createdVehicleIds.length = 0
})

/**
 * Drizzle wraps postgres-js errors as QueryError with a generic
 * "Failed query: ..." message. The underlying postgres error (with the
 * constraint name) lives on `.cause`. This helper asserts that a thrown
 * error's cause chain mentions the expected constraint.
 */
async function expectConstraintViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await promise
  } catch (err) {
    const chain: string[] = []
    let current: unknown = err
    // Drill through cause chain + any string-ish properties that might
    // carry the constraint name (postgres-js exposes `constraint_name`).
    for (let depth = 0; depth < 5 && current != null; depth++) {
      if (current instanceof Error) {
        chain.push(current.message)
        const withConstraint = current as Error & { constraint_name?: string }
        if (withConstraint.constraint_name) chain.push(withConstraint.constraint_name)
        current = (current as Error & { cause?: unknown }).cause
      } else {
        break
      }
    }
    const joined = chain.join(' | ')
    if (!joined.includes(constraintName)) {
      throw new Error(
        `expected error chain to mention ${constraintName}, got: ${joined || '(empty chain)'}`,
      )
    }
    return
  }
  throw new Error(`expected promise to reject with ${constraintName}, but it resolved`)
}

function baseVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Test Vehicle',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    ...overrides,
  }
}

describe('DrizzleVehicleRepository — pricing (#48)', () => {
  describe('create', () => {
    it('round-trips a vehicle with only dailyRateJpy', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 9000, hourlyRateJpy: null }))
      createdVehicleIds.push(created.id)

      expect(created.dailyRateJpy).toBe(9000)
      expect(created.hourlyRateJpy).toBeNull()

      const found = await repo.findById(created.id)
      expect(found).toBeDefined()
      expect(found!.dailyRateJpy).toBe(9000)
      expect(found!.hourlyRateJpy).toBeNull()
    })

    it('round-trips a vehicle with only hourlyRateJpy', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: null, hourlyRateJpy: 1500 }))
      createdVehicleIds.push(created.id)

      expect(created.dailyRateJpy).toBeNull()
      expect(created.hourlyRateJpy).toBe(1500)

      const found = await repo.findById(created.id)
      expect(found!.dailyRateJpy).toBeNull()
      expect(found!.hourlyRateJpy).toBe(1500)
    })

    it('round-trips a vehicle with both rates set', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 12000, hourlyRateJpy: 2000 }))
      createdVehicleIds.push(created.id)

      expect(created.dailyRateJpy).toBe(12000)
      expect(created.hourlyRateJpy).toBe(2000)
    })

    it('accepts zero as a valid rate (free promo)', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 0, hourlyRateJpy: null }))
      createdVehicleIds.push(created.id)

      expect(created.dailyRateJpy).toBe(0)
    })

    it('rejects a vehicle with both rates null at the DB level (CHECK constraint)', async () => {
      // Bypasses the zod validator by going straight through the repo — the
      // DB constraint is the last line of defence. Writers that don't hit
      // the validator (e.g. a future migration script or an ops repair
      // query) must not be able to sneak an un-priced vehicle in.
      await expectConstraintViolation(
        repo.create(baseVehicle({ dailyRateJpy: null, hourlyRateJpy: null })),
        'vehicles_pricing_at_least_one',
      )
    })

    it('rejects a negative daily rate at the DB level (CHECK constraint)', async () => {
      await expectConstraintViolation(
        repo.create(baseVehicle({ dailyRateJpy: -100 })),
        'vehicles_daily_rate_non_negative',
      )
    })

    it('rejects a negative hourly rate at the DB level (CHECK constraint)', async () => {
      await expectConstraintViolation(
        repo.create(baseVehicle({ dailyRateJpy: null, hourlyRateJpy: -50 })),
        'vehicles_hourly_rate_non_negative',
      )
    })
  })

  describe('update', () => {
    it('updates dailyRateJpy independently of other fields', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 8000 }))
      createdVehicleIds.push(created.id)

      const updated = await repo.update(created.id, { dailyRateJpy: 10000 })

      expect(updated).toBeDefined()
      expect(updated!.dailyRateJpy).toBe(10000)
      // Other fields preserved
      expect(updated!.name).toBe('Test Vehicle')
      expect(updated!.hourlyRateJpy).toBeNull()
    })

    it('allows setting hourlyRateJpy on a daily-only vehicle', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 8000, hourlyRateJpy: null }))
      createdVehicleIds.push(created.id)

      const updated = await repo.update(created.id, { hourlyRateJpy: 1200 })

      expect(updated!.dailyRateJpy).toBe(8000)
      expect(updated!.hourlyRateJpy).toBe(1200)
    })

    it('allows clearing dailyRateJpy when hourlyRateJpy remains set', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 8000, hourlyRateJpy: 1200 }))
      createdVehicleIds.push(created.id)

      const updated = await repo.update(created.id, { dailyRateJpy: null })

      expect(updated!.dailyRateJpy).toBeNull()
      expect(updated!.hourlyRateJpy).toBe(1200)
    })

    it('rejects an update that would leave both rates null (CHECK constraint)', async () => {
      const created = await repo.create(baseVehicle({ dailyRateJpy: 8000, hourlyRateJpy: null }))
      createdVehicleIds.push(created.id)

      await expectConstraintViolation(
        repo.update(created.id, { dailyRateJpy: null, hourlyRateJpy: null }),
        'vehicles_pricing_at_least_one',
      )

      // The original row must be unchanged (CHECK constraint rolls the
      // transaction back).
      const stillThere = await repo.findById(created.id)
      expect(stillThere!.dailyRateJpy).toBe(8000)
    })
  })

  describe('findAll', () => {
    it('returns the new rate columns on every row', async () => {
      const a = await repo.create(baseVehicle({ name: 'Car A', dailyRateJpy: 8000 }))
      const b = await repo.create(
        baseVehicle({ name: 'Car B', dailyRateJpy: null, hourlyRateJpy: 1500 }),
      )
      createdVehicleIds.push(a.id, b.id)

      const all = await repo.findAll()
      const aRow = all.find((v) => v.id === a.id)!
      const bRow = all.find((v) => v.id === b.id)!

      expect(aRow.dailyRateJpy).toBe(8000)
      expect(aRow.hourlyRateJpy).toBeNull()
      expect(bRow.dailyRateJpy).toBeNull()
      expect(bRow.hourlyRateJpy).toBe(1500)
    })
  })
})
