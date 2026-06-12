import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { locations } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgErrorCode } from '../../src/pg-errors'
import { db } from './setup'

// #551: the `locations_turnaround_min_60` CHECK (defaultTurnaroundMinutes >= 60,
// migration 0050) is the DB-level backstop behind the Zod 400 (turnaroundSchema
// `.min(60)`). The route rejects a sub-floor turnaround first, but a direct
// INSERT (seed, import, raw SQL, admin tooling) must still bounce off the CHECK
// with Postgres 23514 (check_violation). In-memory repos cannot exercise a
// DB-only CHECK, so this drives raw inserts against real Postgres.
describe('locations turnaround floor CHECK (23514)', () => {
  const createdIds: string[] = []

  // Inlined raw values (Zod-bypassed) so the sub-floor path is reachable —
  // seedLocation defaults to a valid 2880. Unique name per row mirrors the other
  // integration files so parallel suites don't collide on (operatorId, name).
  function locationValues(defaultTurnaroundMinutes: number) {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return {
      id: crypto.randomUUID(),
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: `Turnaround Floor ${uniq}`,
      address: '1-1 Namba, Chuo-ku, Osaka',
      operatingHours: { openTime: '09:00', closeTime: '18:00' },
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes,
      status: 'ACTIVE' as const,
    }
  }

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(locations).where(eq(locations.id, id))
    }
  })

  it('rejects a sub-floor turnaround (30) with 23514', async () => {
    try {
      const [row] = await db
        .insert(locations)
        .values(locationValues(30))
        .returning({ id: locations.id })
      // Reaching here means the CHECK did not fire — track for cleanup, then fail.
      if (row) createdIds.push(row.id)
      expect.unreachable('Expected turnaround floor CHECK violation')
    } catch (err) {
      // Assert through the same abstraction production code uses (pg-errors.ts).
      expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    }
  })

  it('persists a turnaround at the 60-minute floor', async () => {
    const [row] = await db.insert(locations).values(locationValues(60)).returning({
      id: locations.id,
      defaultTurnaroundMinutes: locations.defaultTurnaroundMinutes,
    })
    if (!row) throw new Error('insert returned no row')
    createdIds.push(row.id)
    expect(row.defaultTurnaroundMinutes).toBe(60)
  })
})
