import { describe, expect, it } from 'vitest'
import type { VehicleClass } from '../../stores'
import { InMemoryVehicleClassRepository } from './vehicle-class'

// #1279 (follow-up to #1271): operatorId is an immutable tenant anchor. The
// write layer must never let an update payload migrate a row to another
// operator. vehicle_class is the FK parent of the fee-schedule composite FK, so
// its tenant is doubly load-bearing.
const seed = (operatorId: string): Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name: 'Compact',
  slug: `compact-${operatorId}`,
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

describe('InMemoryVehicleClassRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryVehicleClassRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(created.id, { operatorId: 'op_b', seats: 7 })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.seats).toBe(7)
  })
})
