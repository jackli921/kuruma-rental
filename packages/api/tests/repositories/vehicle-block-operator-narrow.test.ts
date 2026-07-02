import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { InMemoryVehicleBlockRepository } from '../../src/repositories/in-memory/vehicle-block'

// #1230 slice 5b: a picker admin (vehicleBlockReadScope `all`) narrows the fleet-wide
// block read to one operator. vehicleBlockReadScope's `all` is bypass-only, so the
// narrow rides it cleanly; a tenant operator's own scope always wins.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const FROM = new Date('2026-07-01T00:00:00Z')
const TO = new Date('2026-07-02T00:00:00Z')

async function seedTwoOperators(): Promise<InMemoryVehicleBlockRepository> {
  const repo = new InMemoryVehicleBlockRepository()
  await repo.create({
    operatorId: 'op-A',
    vehicleId: 'veh-A',
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE',
    reason: 'a',
    notes: null,
    createdBy: 'u',
  })
  await repo.create({
    operatorId: 'op-B',
    vehicleId: 'veh-B',
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE',
    reason: 'b',
    notes: null,
    createdBy: 'u',
  })
  return repo
}

describe('vehicle-block findOverlappingInRange operator narrowing (#1230 slice 5b)', () => {
  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(admin, FROM, TO, 'op-A')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(admin, FROM, TO)
    expect(rows).toHaveLength(2)
  })

  it('a tenant operator ignores a foreign operatorId (base scope wins, H2)', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(opA, FROM, TO, 'op-B')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })
})
