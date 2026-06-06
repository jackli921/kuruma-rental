import { locations, operators, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #411: a PLATFORM_ADMIN/STAFF (bypass) create names the target operator in the
// body. A non-existent operatorId clears Zod + the duplicate-name pre-check, then
// violates locations_operatorId_operators_id_fk (23503) at the DB. The route must
// map that to 422 "Invalid operator" — the FK->422 contract #400 standardized for
// vehicle/class writes — not surface a raw 500. In-memory repos can't exercise the
// DB-only FK, so this drives the full HTTP app against real Postgres.
describe('POST /locations maps a non-existent operatorId to 422 (#411)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_loc_fk_${uniq}`
  const staffUserId = crypto.randomUUID()
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  // Bypass caller (STAFF) names the operator explicitly via the body.
  const locationBody = (operatorId: string, name: string) => ({
    operatorId,
    name,
    address: '1-1 Namba, Chuo-ku, Osaka',
  })

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(operators).values({ id: opId, slug: `loc-fk-${uniq}`, name: 'Loc FK Operator' })
    await db.insert(users).values({
      id: staffUserId,
      email: `loc-fk-${uniq}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      locationRepo: new DrizzleLocationRepository(db),
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
    await db.delete(users).where(inArray(users.id, [staffUserId]))
  })

  const post = (body: unknown) =>
    app.request('/locations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('returns 422 "Invalid operator" for a non-existent operatorId', async () => {
    const res = await post(locationBody(`op_missing_${uniq}`, 'Namba FK'))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid operator')
  })

  it('returns 201 for an existing operator (catch does not break valid creates)', async () => {
    const res = await post(locationBody(opId, 'Namba OK'))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(opId)
  })
})
