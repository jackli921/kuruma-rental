import { describe, expect, it } from 'vitest'
import { InMemoryFeatureFlagRepository } from '../../src/repositories/in-memory/feature-flags'
import { FeatureFlagsService } from '../../src/services/feature-flags'

// #1437: the server enforces SHARED_CATALOG, so it needs a definitive isEnabled()
// that floors to the registry serverDefault when no admin override exists (the
// override map is sparse). This single-sources the default with the web flooring,
// so server enforcement and the web surface can never disagree on "catalog ON".
describe('FeatureFlagsService.isEnabled', () => {
  it('returns the registry serverDefault (ON) for SHARED_CATALOG with no override', async () => {
    const service = new FeatureFlagsService(new InMemoryFeatureFlagRepository())
    expect(await service.isEnabled('SHARED_CATALOG')).toBe(true)
  })

  it('honours an admin override that turns SHARED_CATALOG off', async () => {
    const repo = new InMemoryFeatureFlagRepository()
    await repo.setOverride('SHARED_CATALOG', false)
    const service = new FeatureFlagsService(repo)
    expect(await service.isEnabled('SHARED_CATALOG')).toBe(false)
  })

  it('honours an admin override that turns SHARED_CATALOG back on', async () => {
    const repo = new InMemoryFeatureFlagRepository()
    await repo.setOverride('SHARED_CATALOG', true)
    const service = new FeatureFlagsService(repo)
    expect(await service.isEnabled('SHARED_CATALOG')).toBe(true)
  })
})
