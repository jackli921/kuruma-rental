import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { describe, expect, it } from 'vitest'
import { isBuildTimeEnabled, resolveFeatureFlag } from './feature-flags-runtime'

// #1437: the SHARED_CATALOG kill-switch is serverOnly + default-ON. The web override
// map is SPARSE (a key present IFF an admin set it), so in the normal default-ON state
// there is NO override row for it. A naive resolver would then fall to the build-time
// reader, which for an envless flag yields false -> the catalog would hide ITSELF in
// its own default state (the "polarity trap"). resolveFeatureFlag must instead floor a
// serverOnly key to its registry serverDefault. These lock that in.
describe('resolveFeatureFlag - serverOnly flooring (polarity trap)', () => {
  const NO_OVERRIDES: FeatureFlagOverrides = {}

  it('floors SHARED_CATALOG to its serverDefault (ON) when the map is empty', () => {
    // The critical case: default state, no override row, no env. Must be ON, not off.
    expect(resolveFeatureFlag(NO_OVERRIDES, 'SHARED_CATALOG')).toBe(true)
  })

  it('lets an explicit admin override turn SHARED_CATALOG off', () => {
    expect(resolveFeatureFlag({ SHARED_CATALOG: false }, 'SHARED_CATALOG')).toBe(false)
  })

  it('lets an explicit admin override keep SHARED_CATALOG on', () => {
    expect(resolveFeatureFlag({ SHARED_CATALOG: true }, 'SHARED_CATALOG')).toBe(true)
  })

  it('does NOT floor a normal web flag - it falls to its (false) build-time reader', () => {
    // CANCELLATION has no override and no env set in the test env, so it resolves off.
    // This proves flooring is scoped to serverOnly keys, not applied blanket.
    expect(resolveFeatureFlag(NO_OVERRIDES, 'CANCELLATION')).toBe(false)
  })

  it('isBuildTimeEnabled returns false for a serverOnly flag (it has no reader)', () => {
    // Documents WHY resolveFeatureFlag must floor: the build-time reader alone is false.
    expect(isBuildTimeEnabled('SHARED_CATALOG')).toBe(false)
  })
})
