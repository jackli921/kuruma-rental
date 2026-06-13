import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { feeSchedules } from '@kuruma/shared/db/schema'
import type { FeeType, FeeUnit } from '@kuruma/shared/validators/fee-schedule'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgErrorCode } from '../../src/pg-errors'
import { db } from './setup'

// #723: feeType<->unit coherence (OVERTIME_HOURLY=>PER_HOUR, *_FLAT=>FLAT — see
// REQUIRED_UNIT_BY_FEE_TYPE in shared/validators/fee-schedule.ts) was enforced
// only by the Zod schema + FeeScheduleService (the sole writer). A direct INSERT
// (seed, import, raw SQL) could persist an incoherent pair that breaks overtime
// math. The DB CHECK `fee_schedules_feetype_unit_coherent` is the backstop; an
// in-memory repo cannot exercise a DB-only CHECK, so this drives raw inserts at
// real Postgres. Rows use status 'ARCHIVED' to dodge the ACTIVE-only uniqueness
// indexes — the CHECK is status-independent, so each insert tests ONLY coherence.
describe('fee_schedules feeType<->unit CHECK (23514)', () => {
  const createdIds: string[] = []

  function feeValues(feeType: FeeType, unit: FeeUnit) {
    return {
      id: crypto.randomUUID(),
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      vehicleClassId: null,
      feeType,
      unit,
      amountJpy: 1000,
      status: 'ARCHIVED' as const,
    }
  }

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(feeSchedules).where(eq(feeSchedules.id, id))
    }
  })

  it('rejects an incoherent OVERTIME_HOURLY + FLAT pair with 23514', async () => {
    try {
      const [row] = await db
        .insert(feeSchedules)
        .values(feeValues('OVERTIME_HOURLY', 'FLAT'))
        .returning({ id: feeSchedules.id })
      if (row) createdIds.push(row.id)
      expect.unreachable('Expected feeType/unit coherence CHECK violation')
    } catch (err) {
      expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    }
  })

  it('rejects an incoherent CLEANING_FLAT + PER_HOUR pair with 23514', async () => {
    try {
      const [row] = await db
        .insert(feeSchedules)
        .values(feeValues('CLEANING_FLAT', 'PER_HOUR'))
        .returning({ id: feeSchedules.id })
      if (row) createdIds.push(row.id)
      expect.unreachable('Expected feeType/unit coherence CHECK violation')
    } catch (err) {
      expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    }
  })

  it('persists the coherent OVERTIME_HOURLY + PER_HOUR pair', async () => {
    const [row] = await db
      .insert(feeSchedules)
      .values(feeValues('OVERTIME_HOURLY', 'PER_HOUR'))
      .returning({ id: feeSchedules.id, unit: feeSchedules.unit })
    if (!row) throw new Error('insert returned no row')
    createdIds.push(row.id)
    expect(row.unit).toBe('PER_HOUR')
  })

  it('persists the coherent CLEANING_FLAT + FLAT pair', async () => {
    const [row] = await db
      .insert(feeSchedules)
      .values(feeValues('CLEANING_FLAT', 'FLAT'))
      .returning({ id: feeSchedules.id, unit: feeSchedules.unit })
    if (!row) throw new Error('insert returned no row')
    createdIds.push(row.id)
    expect(row.unit).toBe('FLAT')
  })
})
