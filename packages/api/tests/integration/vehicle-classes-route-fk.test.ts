import { operators, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { VehicleClass } from '../../src/stores'
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

// #1279: operatorId is an immutable tenant anchor. vehicle_class is the FK
// parent of the fee-schedule composite FK, so re-homing it across tenants is
// doubly load-bearing. Even if a caller reaches repo.update with operatorId in
// the payload (bypassing the service DTO), the write layer must strip it.
// Probed directly at repo.update because that is where the IDOR vector lives.
describe('vehicle-class update() cannot re-home a row across operators (#1279)', () => {
  const repo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_vcseal_a_${uniq}`
  const opBId = `op_vcseal_b_${uniq}`
  const slug = `vcseal-compact-${uniq}`
  let classA: VehicleClass

  const classInput = (
    operatorId: string,
  ): Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'> => ({
    operatorId,
    name: 'Compact',
    slug,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
  })

  beforeAll(async () => {
    // Both operators exist so a failed strip would actually migrate the FK
    // (surfacing the bug) rather than 23503-rejecting on a missing operator.
    await db.insert(operators).values([
      { id: opAId, slug: `vcseal-a-${uniq}`, name: 'VcSeal Operator A' },
      { id: opBId, slug: `vcseal-b-${uniq}`, name: 'VcSeal Operator B' },
    ])
    classA = await repo.create(classInput(opAId))
  })

  afterAll(async () => {
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('ignores operatorId in the payload while applying other fields', async () => {
    const updated = await repo.update(SYSTEM_CONTEXT, classA.id, { operatorId: opBId, seats: 7 })
    expect(updated?.operatorId).toBe(opAId)
    expect(updated?.seats).toBe(7)

    // Persisted, not just the returned row: re-read across tenants.
    const reread = await repo.findById(SYSTEM_CONTEXT, classA.id)
    expect(reread?.operatorId).toBe(opAId)
  })
})
