import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryVehicleBlockRepository } from './vehicle-block'

const OP = 'op_a'
const VEH = 'veh_1'

const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opACtx: CallerContext = { userId: 'u_a', role: 'OPERATOR_OWNER', operatorId: 'op_a' }
const opBCtx: CallerContext = { userId: 'u_b', role: 'OPERATOR_OWNER', operatorId: 'op_b' }

const T0 = new Date('2026-09-01T00:00:00Z')
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000)

let repo: InMemoryVehicleBlockRepository

beforeEach(() => {
  repo = new InMemoryVehicleBlockRepository()
})

function seed(overrides: Partial<Parameters<InMemoryVehicleBlockRepository['create']>[0]> = {}) {
  return repo.create({
    operatorId: OP,
    vehicleId: VEH,
    startAt: hours(0),
    endAt: hours(48),
    kind: 'MAINTENANCE',
    reason: 'scheduled service',
    notes: null,
    createdBy: 'user_op',
    ...overrides,
  })
}

describe('InMemoryVehicleBlockRepository', () => {
  it('create assigns an id + createdAt and round-trips the fields', async () => {
    const block = await seed({ reason: 'brakes' })
    expect(block.id).toMatch(/[0-9a-f-]{36}/)
    expect(block.createdAt).toBeInstanceOf(Date)
    expect(block.reason).toBe('brakes')
    expect(block.kind).toBe('MAINTENANCE')
    expect(block.vehicleId).toBe(VEH)
    expect(block.operatorId).toBe(OP)
  })

  it('findById returns the stored block, undefined for an unknown id', async () => {
    const block = await seed()
    expect(await repo.findById(block.id)).toEqual(block)
    expect(await repo.findById('nope')).toBeUndefined()
  })

  describe('findOverlapping', () => {
    it('returns a block whose window overlaps the query range', async () => {
      const block = await seed({ startAt: hours(10), endAt: hours(20) })
      const hits = await repo.findOverlapping(VEH, hours(15), hours(25))
      expect(hits).toEqual([block])
    })

    it('excludes a block on a different vehicle', async () => {
      await seed({ vehicleId: 'veh_other', startAt: hours(10), endAt: hours(20) })
      expect(await repo.findOverlapping(VEH, hours(10), hours(20))).toEqual([])
    })

    it('treats adjacent windows as non-overlapping (half-open [start,end))', async () => {
      await seed({ startAt: hours(0), endAt: hours(10) })
      // query starts exactly where the block ends → no overlap
      expect(await repo.findOverlapping(VEH, hours(10), hours(20))).toEqual([])
      // query ends exactly where the block starts → no overlap
      expect(await repo.findOverlapping(VEH, hours(-10), hours(0))).toEqual([])
    })

    it('returns a block that fully contains the query range', async () => {
      const block = await seed({ startAt: hours(0), endAt: hours(48) })
      expect(await repo.findOverlapping(VEH, hours(20), hours(28))).toEqual([block])
    })
  })

  describe('findOverlappingInRange', () => {
    it('operator scope returns only the caller-tenant blocks overlapping the window', async () => {
      const mine = await seed({ operatorId: 'op_a', startAt: hours(10), endAt: hours(20) })
      await seed({ operatorId: 'op_b', vehicleId: 'veh_b', startAt: hours(10), endAt: hours(20) })
      const hits = await repo.findOverlappingInRange(opACtx, hours(12), hours(18))
      expect(hits).toEqual([mine])
    })

    it('all scope (admin) returns blocks across operators in the window', async () => {
      const a = await seed({ operatorId: 'op_a', startAt: hours(10), endAt: hours(20) })
      const b = await seed({
        operatorId: 'op_b',
        vehicleId: 'veh_b',
        startAt: hours(10),
        endAt: hours(20),
      })
      const hits = await repo.findOverlappingInRange(adminCtx, hours(0), hours(48))
      expect(new Set(hits)).toEqual(new Set([a, b]))
    })

    it('none scope (operator missing operatorId) returns []', async () => {
      await seed({ startAt: hours(10), endAt: hours(20) })
      const noneCtx: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF' }
      expect(await repo.findOverlappingInRange(noneCtx, hours(0), hours(48))).toEqual([])
    })

    it('excludes a block outside the window (half-open, adjacent = no overlap)', async () => {
      await seed({ operatorId: 'op_b', startAt: hours(0), endAt: hours(10) })
      expect(await repo.findOverlappingInRange(opBCtx, hours(10), hours(20))).toEqual([])
    })
  })

  describe('delete', () => {
    it('removes an operator-owned block and returns it', async () => {
      const block = await seed()
      expect(await repo.delete(block.id, OP)).toEqual(block)
      expect(await repo.findById(block.id)).toBeUndefined()
    })

    it('refuses to delete another tenant block and leaves it intact', async () => {
      const block = await seed()
      expect(await repo.delete(block.id, 'op_other')).toBeUndefined()
      expect(await repo.findById(block.id)).toEqual(block)
    })

    it('returns undefined for an unknown id', async () => {
      expect(await repo.delete('nope', OP)).toBeUndefined()
    })
  })
})
