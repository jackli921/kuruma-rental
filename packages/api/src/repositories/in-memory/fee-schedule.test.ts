import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { FeeSchedule } from '../../stores'
import { InMemoryFeeScheduleRepository } from './fee-schedule'

// #1271: operatorId is a tenant anchor — see add-on.test.ts. A fee's tenant is
// also load-bearing for the composite FK to vehicleClasses, so an update must
// never repoint it.
const seed = (operatorId: string): Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  vehicleClassId: null,
  feeType: 'CLEANING_FLAT',
  unit: 'FLAT',
  amountJpy: 2000,
  status: 'ACTIVE',
})

describe('InMemoryFeeScheduleRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(SYSTEM_CONTEXT, created.id, {
      operatorId: 'op_b',
      amountJpy: 3000,
    })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.amountJpy).toBe(3000)
  })
})
