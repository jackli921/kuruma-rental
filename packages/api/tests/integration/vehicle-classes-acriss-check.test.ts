import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { vehicleClasses } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgErrorCode } from '../../src/pg-errors'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #419: the `vehicle_classes_acriss_code_format` CHECK
// (`acrissCode IS NULL OR acrissCode ~ '^[A-Z9]{4}$'`, migration 0030) is the
// DB-level backstop behind the Zod 400. The route rejects malformed codes
// first, but a direct INSERT (seed, import, raw SQL) must still bounce off the
// CHECK with Postgres 23514 (check_violation). In-memory repos cannot exercise
// a DB-only CHECK, so this drives raw inserts against real Postgres.
// Source of truth for the pattern: `ACRISS_PATTERN` in packages/shared/src/acriss.ts.
describe('vehicle_classes acrissCode CHECK (23514)', () => {
  const createdIds: string[] = []

  // Inlined rather than reusing setup.ts `seedVehicleClass`: that helper takes
  // no acrissCode override, and the malformed-code path needs one. Unique
  // name/slug per row mirrors the helper so parallel test files don't collide.
  function classValues(acrissCode: string | null) {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return {
      id: crypto.randomUUID(),
      // Transitional tenant (#386); vehicle_classes is not operator-scoped yet.
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: `ACRISS Check ${uniq}`,
      slug: `acriss-check-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO' as const,
      fuelType: null,
      acrissCode,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE' as const,
    }
  }

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(vehicleClasses).where(eq(vehicleClasses.id, id))
    }
  })

  it('rejects a lowercase, too-short code ("cc") with 23514', async () => {
    try {
      const [row] = await db
        .insert(vehicleClasses)
        .values(classValues('cc'))
        .returning({ id: vehicleClasses.id })
      // Reaching here means the CHECK did not fire — track for cleanup, then fail.
      if (row) createdIds.push(row.id)
      expect.unreachable('Expected acrissCode CHECK violation')
    } catch (err) {
      // Assert through the same abstraction production code uses (pg-errors.ts).
      expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    }
  })

  it('persists a valid 4-char code ("MCAR")', async () => {
    const [row] = await db
      .insert(vehicleClasses)
      .values(classValues('MCAR'))
      .returning({ id: vehicleClasses.id, acrissCode: vehicleClasses.acrissCode })
    if (!row) throw new Error('insert returned no row')
    createdIds.push(row.id)
    expect(row.acrissCode).toBe('MCAR')
  })

  it('persists a null code (the IS NULL branch of the CHECK)', async () => {
    const [row] = await db
      .insert(vehicleClasses)
      .values(classValues(null))
      .returning({ id: vehicleClasses.id, acrissCode: vehicleClasses.acrissCode })
    if (!row) throw new Error('insert returned no row')
    createdIds.push(row.id)
    expect(row.acrissCode).toBeNull()
  })
})
