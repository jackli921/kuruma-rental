import { locations, operators } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import { DrizzleLocationRepository } from '../../src/repositories/drizzle'
import { DrizzleBookingRepository } from '../../src/repositories/drizzle/booking'
import { LocationService } from '../../src/services/location'
import type { Location } from '../../src/stores'
import { db } from './setup'

// Locations are operator-scoped (#387). Mirrors the vehicle-class isolation
// suite: an OPERATOR_* caller only ever observes its own tenant's locations,
// a tenant-less operator fails closed, and admins (SYSTEM_CONTEXT) read across.
// Name uniqueness is PER OPERATOR and ACTIVE-ONLY — two tenants may both run a
// "Namba" store, and archiving frees the name (#410) — sealed at the DB by the
// partial unique index locations_operatorId_active_name_unique (23505).
// Exercised against real Postgres so the scope filter and constraint are
// proven, not just the in-memory stand-in.

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

const locationInput = (
  operatorId: string,
  name: string,
): Omit<Location, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name,
  address: '1-1 Namba, Chuo-ku, Osaka',
  operatingHours: { openTime: '09:00', closeTime: '18:00' },
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 2880,
  status: 'ACTIVE',
})

const PG_UNIQUE_VIOLATION = '23505'
const violationCode = (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (err) => pgErrorCode(err),
  )

describe('cross-operator location isolation (Drizzle)', () => {
  const repo = new DrizzleLocationRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_loc_a_${uniq}`
  const opBId = `op_loc_b_${uniq}`
  let locationA: Location
  let locationB: Location

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `loc-a-${uniq}`, name: 'Loc Operator A' },
      { id: opBId, slug: `loc-b-${uniq}`, name: 'Loc Operator B' },
    ])
    // Both tenants name a store "Namba" to prove uniqueness is per-operator.
    locationA = await repo.create(locationInput(opAId, 'Namba'))
    locationB = await repo.create(locationInput(opBId, 'Namba'))
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('stamps the requested operatorId on each tenant write', () => {
    expect(locationA.operatorId).toBe(opAId)
    expect(locationB.operatorId).toBe(opBId)
  })

  it('two operators may both own a location with the same name', () => {
    expect(locationA.name).toBe('Namba')
    expect(locationB.name).toBe('Namba')
    expect(locationA.id).not.toBe(locationB.id)
  })

  it('findAll returns only the scoped tenant locations', async () => {
    const ids = (await repo.findAll(ctxFor(opAId))).map((l) => l.id)
    expect(ids).toContain(locationA.id)
    expect(ids).not.toContain(locationB.id)
  })

  it('findById cannot reach another tenant location', async () => {
    const ctxA = ctxFor(opAId)
    expect(await repo.findById(ctxA, locationA.id)).toMatchObject({ id: locationA.id })
    expect(await repo.findById(ctxA, locationB.id)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toHaveLength(0)
    expect(await repo.findById(noTenant, locationA.id)).toBeUndefined()
  })

  it('SYSTEM_CONTEXT reads locations across operators', async () => {
    const ids = (await repo.findAll(SYSTEM_CONTEXT)).map((l) => l.id)
    expect(ids).toContain(locationA.id)
    expect(ids).toContain(locationB.id)
  })
})

describe('location name uniqueness is sealed per operator (23505)', () => {
  const repo = new DrizzleLocationRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_locu_a_${uniq}`
  const opBId = `op_locu_b_${uniq}`

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `locu-a-${uniq}`, name: 'LocU Operator A' },
      { id: opBId, slug: `locu-b-${uniq}`, name: 'LocU Operator B' },
    ])
    await repo.create(locationInput(opAId, 'Shinsaibashi'))
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('rejects a duplicate (operatorId, name) at the DB', async () => {
    expect(await violationCode(repo.create(locationInput(opAId, 'Shinsaibashi')))).toBe(
      PG_UNIQUE_VIOLATION,
    )
  })

  it('accepts the same name under a different operator', async () => {
    const sibling = await repo.create(locationInput(opBId, 'Shinsaibashi'))
    expect(sibling.name).toBe('Shinsaibashi')
    expect(sibling.operatorId).toBe(opBId)
  })
})

// #410: a storefront name is a property of *active* inventory. Uniqueness is
// sealed by a partial index over non-archived rows, so archiving a location
// frees its name for re-use — while two live locations still can't collide.
describe('archiving a location frees its name for re-creation (#410)', () => {
  const repo = new DrizzleLocationRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_locr_${uniq}`

  beforeAll(async () => {
    await db.insert(operators).values({ id: opId, slug: `locr-${uniq}`, name: 'LocR Operator' })
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
  })

  it('re-creates a name after the prior location is archived', async () => {
    const first = await repo.create(locationInput(opId, 'Dotonbori'))
    await repo.archive(first.id)
    const second = await repo.create(locationInput(opId, 'Dotonbori'))
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('ACTIVE')
  })

  it('still rejects two ACTIVE locations with the same name', async () => {
    await repo.create(locationInput(opId, 'Namba Parks'))
    expect(await violationCode(repo.create(locationInput(opId, 'Namba Parks')))).toBe(
      PG_UNIQUE_VIOLATION,
    )
  })
})

// Location writes (update/archive) take no ctx at the repo; the tenant seal
// lives in LocationService via its caller-scoped findById. This probes that
// seal against real Postgres: operator B must not mutate operator A's location.
// Resolves to 404 (no cross-tenant existence leak), leaving the row untouched.
describe('cross-operator location WRITE denial (service seal, #387)', () => {
  const repo = new DrizzleLocationRepository(db)
  const service = new LocationService(repo, new DrizzleBookingRepository(db))
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_locw_a_${uniq}`
  const opBId = `op_locw_b_${uniq}`
  let locationA: Location

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `locw-a-${uniq}`, name: 'LocW Operator A' },
      { id: opBId, slug: `locw-b-${uniq}`, name: 'LocW Operator B' },
    ])
    locationA = await repo.create(locationInput(opAId, 'Umeda'))
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B cannot update operator A location (404, row untouched)', async () => {
    const res = await service.update(ctxFor(opBId), locationA.id, { name: 'hijacked' })
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Location not found' })
    expect(await repo.findById(SYSTEM_CONTEXT, locationA.id)).toMatchObject({ name: 'Umeda' })
  })

  it('operator B cannot archive operator A location (404, still ACTIVE)', async () => {
    const res = await service.archive(ctxFor(opBId), locationA.id)
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(await repo.findById(SYSTEM_CONTEXT, locationA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own location', async () => {
    const res = await service.update(ctxFor(opAId), locationA.id, { name: 'Umeda HQ' })
    expect(res).toMatchObject({ ok: true, location: { name: 'Umeda HQ' } })
  })
})
