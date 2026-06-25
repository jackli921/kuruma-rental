import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import type { AddOn } from '../../stores'
import { InMemoryAddOnRepository } from './add-on'

// #1107 (audit M3): the cross-operator read-scope default must live BELOW the
// route. A bypass caller (PLATFORM_ADMIN) that reaches the repo with no explicit
// scope — the exact state a forgotten route guard produces — must read nothing,
// not enumerate every tenant's private config.

const addOn = (id: string, operatorId: string): AddOn => ({
  id,
  operatorId,
  name: `${id}-name`,
  description: null,
  priceJpy: 1000,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

const SEED: AddOn[] = [addOn('op1-a', 'op1'), addOn('op2-a', 'op2')]

const seededRepo = () => new InMemoryAddOnRepository(new Map(SEED.map((o) => [o.id, o])))

const PLATFORM_ADMIN: CallerContext = {
  userId: 'admin',
  role: 'PLATFORM_ADMIN',
  bypassScope: true,
}
const OPERATOR_1: CallerContext = {
  userId: 'o1',
  role: 'OPERATOR_OWNER',
  operatorId: 'op1',
}

describe('InMemoryAddOnRepository read-scope (#1107)', () => {
  it('bypass caller with no explicit scope reads nothing (defence-in-depth backstop)', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, {})
    expect(rows).toEqual([])
  })

  it('bypass caller with includeAllOperators reads every tenant', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, { includeAllOperators: true })
    expect(new Set(rows.map((o) => o.id))).toEqual(new Set(['op1-a', 'op2-a']))
  })

  it('bypass caller with operatorId narrows to that one tenant', async () => {
    const rows = await seededRepo().findAll(PLATFORM_ADMIN, { operatorId: 'op2' })
    expect(rows.map((o) => o.id)).toEqual(['op2-a'])
  })

  it('operator caller auto-scopes to its own tenant, ignoring includeAllOperators', async () => {
    const rows = await seededRepo().findAll(OPERATOR_1, { includeAllOperators: true })
    expect(rows.map((o) => o.id)).toEqual(['op1-a'])
  })
})
