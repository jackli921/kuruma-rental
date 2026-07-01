import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryFeatureFlagRepository } from '../../src/repositories/in-memory'

describe('InMemoryFeatureFlagRepository', () => {
  let repo: InMemoryFeatureFlagRepository

  beforeEach(() => {
    repo = new InMemoryFeatureFlagRepository()
  })

  it('returns an empty override map when nothing is set', async () => {
    expect(await repo.getOverrides()).toEqual({})
  })

  it('persists an override and reads it back as a sparse map', async () => {
    await repo.setOverride('MULTI_CURRENCY', true, 'admin_1')
    expect(await repo.getOverrides()).toEqual({ MULTI_CURRENCY: true })
  })

  it('upserts — a second set on the same key overwrites the value', async () => {
    await repo.setOverride('REVIEWS', true, 'admin_1')
    await repo.setOverride('REVIEWS', false, 'admin_2')
    expect(await repo.getOverrides()).toEqual({ REVIEWS: false })
  })

  it('keeps overrides for distinct keys independent', async () => {
    await repo.setOverride('MULTI_CURRENCY', true, 'admin_1')
    await repo.setOverride('FLEET_TIMELINE', false, 'admin_1')
    expect(await repo.getOverrides()).toEqual({ MULTI_CURRENCY: true, FLEET_TIMELINE: false })
  })
})
