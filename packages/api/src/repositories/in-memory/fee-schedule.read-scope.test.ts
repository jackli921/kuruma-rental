import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import type { FeeSchedule } from '../../stores'
import { InMemoryFeeScheduleRepository } from './fee-schedule'

// #1107 (audit M3): the cross-operator read-scope default must live BELOW the
// route. A bypass caller (PLATFORM_ADMIN) that reaches the repo with no explicit
// scope — the exact state a forgotten route guard produces — must read nothing,
// not enumerate every tenant's private fee config.

const fee = (id: string, operatorId: string): FeeSchedule => ({
  id,
  operatorId,
  vehicleClassId: null,
  feeType: 'CLEANING_FLAT',
  unit: 'FLAT',
  amountJpy: 3000,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

const SEED: FeeSchedule[] = [fee('op1-a', 'op1'), fee('op2-a', 'op2')]

const seededRepo = () => new InMemoryFeeScheduleRepository(new Map(SEED.map((f) => [f.id, f])))

const PLATFORM_ADMIN: CallerContext = {
  userId: 'admin',
  role: 'PLATFORM_ADMIN',
  bypassScope: true,
}
const OPERATOR_1: CallerContext = {
  userId: 'owner1',
  role: 'OPERATOR_OWNER',
  operatorId: 'op1',
}

describe('InMemoryFeeScheduleRepository read-scope (#1107)', () => {
  it('bypass caller with no explicit scope reads nothing (defence-in-depth backstop)', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, {})
    expect(rows).toEqual([])
  })

  it('bypass caller with includeAllOperators reads every tenant', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, { includeAllOperators: true })
    expect(new Set(rows.map((f) => f.id))).toEqual(new Set(['op1-a', 'op2-a']))
  })

  it('bypass caller with operatorId narrows to that one tenant', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, { operatorId: 'op2' })
    expect(rows.map((f) => f.id)).toEqual(['op2-a'])
  })

  it('operator caller auto-scopes to its own tenant, ignoring includeAllOperators', async () => {
    const rows = await seededRepo().findAll(OPERATOR_1, { includeAllOperators: true })
    expect(rows.map((f) => f.id)).toEqual(['op1-a'])
  })
})
