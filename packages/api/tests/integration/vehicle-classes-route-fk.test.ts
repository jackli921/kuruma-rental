import { users, vehicleClasses } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #400: vehicle_classes.operatorId is a NOT NULL FK to operators.id
// (vehicle_classes_operatorId_operators_id_fk). A non-operator (STAFF) caller
// that names a non-existent operator hits that FK at the DB with 23503. The
// route must map it to 422 'Invalid operator' rather than letting a raw 500
// page on-call. In-memory repos cannot exercise a DB-only FK, so this drives
// the full HTTP app against real Postgres.
describe('POST /vehicle-classes maps an unknown operatorId to 422 (#400)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const staffUserId = crypto.randomUUID()
  const missingOperatorId = `op_missing_${uniq}`
  const slug = `route-fk-class-${uniq}`
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(users).values({
      id: staffUserId,
      email: `vc-route-fk-${uniq}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      vehicleClassRepo: new DrizzleVehicleClassRepository(db),
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    // The create fails the FK so no class row is written; delete defensively.
    await db.delete(vehicleClasses).where(eq(vehicleClasses.slug, slug))
    await db.delete(users).where(eq(users.id, staffUserId))
  })

  it('returns 422 "Invalid operator" for a non-existent operatorId', async () => {
    const res = await app.request('/vehicle-classes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: missingOperatorId,
        name: 'Route FK Class',
        slug,
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO',
      }),
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid operator')
  })
})
