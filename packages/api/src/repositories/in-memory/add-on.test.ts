import { describe, expect, it } from 'vitest'
import type { AddOn } from '../../stores'
import { InMemoryAddOnRepository } from './add-on'

// #1271: operatorId is a tenant anchor. The write layer must never let an
// update payload migrate a row to another operator, regardless of the caller
// or DTO upstream. This pins that invariant at the repository itself.
const seed = (operatorId: string): Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name: 'Baby Seat',
  description: null,
  priceJpy: 1500,
  status: 'ACTIVE',
})

describe('InMemoryAddOnRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryAddOnRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(created.id, { operatorId: 'op_b', priceJpy: 3000 })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.priceJpy).toBe(3000)
  })
})
