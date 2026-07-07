import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, isFeatureFlagKey } from './registry'

describe('feature flag registry', () => {
  it('gives every web flag a VITE_FEATURE_ env name and every flag a non-empty label', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const entry = FEATURE_FLAGS[key]
      expect(entry.label.length).toBeGreaterThan(0)
      // A serverOnly flag has no web build-time env; its default lives in code
      // (serverDefault). Every other flag pins a VITE_FEATURE_ env.
      if (entry.serverOnly) {
        expect(entry.env).toBeUndefined()
      } else {
        expect(entry.env).toMatch(/^VITE_FEATURE_[A-Z_]+$/)
      }
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

  it('maps each web flag to a distinct env var', () => {
    // serverOnly flags carry no env, so exclude them before the distinctness check.
    const envs = FEATURE_FLAG_KEYS.filter((k) => !FEATURE_FLAGS[k].serverOnly).map(
      (k) => FEATURE_FLAGS[k].env,
    )
    expect(new Set(envs).size).toBe(envs.length)
  })

  it('registers SHARED_CATALOG as a server-only flag (default ON in code, no env)', () => {
    const entry = FEATURE_FLAGS.SHARED_CATALOG
    expect(entry.serverOnly).toBe(true)
    expect(entry.serverDefault).toBe(true)
    expect(entry.env).toBeUndefined()
    expect(entry.runtimeControlled).toBe(true)
  })

  it('gives every server-only flag an explicit boolean serverDefault (fail-safe floor)', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      if (FEATURE_FLAGS[key].serverOnly) {
        expect(typeof FEATURE_FLAGS[key].serverDefault).toBe('boolean')
      }
    }
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
        // #1479 (Tier 2, path-to-GA #1476): the last two build-time-only flags,
        // migrated to useFeatureFlag() so the admin switchboard flips them live.
        'OPERATOR_TODAY',
        // Server-only, but the web reads it via useFeatureFlag() to hide the
        // operator picker + admin template library live, so it is runtimeControlled.
        'SHARED_CATALOG',
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
