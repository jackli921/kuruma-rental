import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, isFeatureFlagKey } from './registry'

describe('feature flag registry', () => {
  it('gives every flag a VITE_FEATURE_ env name and a non-empty label', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const entry = FEATURE_FLAGS[key]
      expect(entry.env).toMatch(/^VITE_FEATURE_[A-Z_]+$/)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('derives the key list straight from the registry (no hand-maintained drift)', () => {
    expect(FEATURE_FLAG_KEYS).toEqual(Object.keys(FEATURE_FLAGS))
  })

  it('covers the three MVP-gated flags migrated by this epic', () => {
    expect(FEATURE_FLAG_KEYS).toEqual(
      expect.arrayContaining(['REVIEWS', 'FLEET_TIMELINE', 'MULTI_CURRENCY']),
    )
  })

  it('maps each flag to a distinct env var', () => {
    const envs = FEATURE_FLAG_KEYS.map((k) => FEATURE_FLAGS[k].env)
    expect(new Set(envs).size).toBe(envs.length)
  })

  it('marks exactly the runtime-migrated flags as runtimeControlled', () => {
    // A flag is runtimeControlled once a consumer reads it via useFeatureFlag(),
    // so a dashboard toggle actually takes effect. Flip this to true in the same
    // slice that migrates the flag (#1322) — the admin page badges the difference.
    const controlled = FEATURE_FLAG_KEYS.filter((k) => FEATURE_FLAGS[k].runtimeControlled)
    // Every flag is migrated as of #1322 (PR3 finished the batch). A newly added,
    // not-yet-migrated flag would be absent here and must be added on migration.
    expect(new Set(controlled)).toEqual(
      new Set([
        'MULTI_CURRENCY',
        'REVIEWS',
        'CANCELLATION',
        'FLEET_TIMELINE',
        'OPERATOR_MANUAL_BOOKING',
        'OPERATOR_BLOCKS',
        'OPERATOR_TEAM',
        'OPERATOR_SETTINGS',
        'RENTER_DOCUMENTS',
        'MESSAGING',
      ]),
    )
  })

  it('gives every flag an explicit boolean runtimeControlled (no accidental undefined)', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof FEATURE_FLAGS[key].runtimeControlled).toBe('boolean')
    }
  })

  it('isFeatureFlagKey accepts a registered key and rejects anything else', () => {
    expect(isFeatureFlagKey('MULTI_CURRENCY')).toBe(true)
    expect(isFeatureFlagKey('DEFINITELY_NOT_A_FLAG')).toBe(false)
    expect(isFeatureFlagKey('')).toBe(false)
  })
})
