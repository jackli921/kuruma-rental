import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT, MAX_LIMIT, clampLimit, decodeCursor, encodeCursor } from './search-paging'

// The public search surfaces (flat, storefront, storefront-detail) share this
// paging scaffold. These tests lock the contract so a cursor/limit change lives in
// exactly one place and every consumer reacts to it. (#1113, audit L1)

describe('clampLimit', () => {
  it('falls back to DEFAULT_LIMIT for undefined / zero / negative', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT)
    expect(clampLimit(0)).toBe(DEFAULT_LIMIT)
    expect(clampLimit(-5)).toBe(DEFAULT_LIMIT)
  })

  it('passes through an in-range limit unchanged', () => {
    expect(clampLimit(1)).toBe(1)
    expect(clampLimit(25)).toBe(25)
    expect(clampLimit(MAX_LIMIT)).toBe(MAX_LIMIT)
  })

  it('caps an over-range limit at MAX_LIMIT', () => {
    expect(clampLimit(MAX_LIMIT + 1)).toBe(MAX_LIMIT)
    expect(clampLimit(1000)).toBe(MAX_LIMIT)
  })
})

describe('cursor codec', () => {
  it('round-trips any string key (decode ∘ encode = identity)', () => {
    for (const key of ['v:veh_123', 'c:loc_9:cls_4', 'loc_storefront_77', '']) {
      expect(decodeCursor(encodeCursor(key))).toBe(key)
    }
  })

  it('encodes to an opaque base64 token, not the raw key', () => {
    const token = encodeCursor('v:veh_123')
    expect(token).not.toContain('v:veh_123')
    expect(token).toBe(btoa('v:veh_123'))
  })

  it('returns undefined for a malformed (non-base64) cursor instead of throwing', () => {
    expect(decodeCursor('%%% not base64 %%%')).toBeUndefined()
  })
})
