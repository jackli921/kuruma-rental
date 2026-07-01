import { describe, expect, it } from 'vitest'
import type { InsuranceOption } from '../../stores'
import { InMemoryInsuranceOptionRepository } from './insurance-option'

// #1271: operatorId is a tenant anchor — see add-on.test.ts. Mirrored here so
// the invariant is pinned per sibling config repo, not assumed by analogy.
const seed = (operatorId: string): Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name: 'Premium',
  description: null,
  dailyPriceJpy: 1500,
  deductibleJpy: 150000,
  status: 'ACTIVE',
})

describe('InMemoryInsuranceOptionRepository.update — operatorId is an immutable tenant anchor', () => {
  it('ignores operatorId in the update payload while still applying other fields', async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const created = await repo.create(seed('op_a'))

    const updated = await repo.update(created.id, { operatorId: 'op_b', dailyPriceJpy: 2000 })

    expect(updated?.operatorId).toBe('op_a')
    expect(updated?.dailyPriceJpy).toBe(2000)
  })
})
