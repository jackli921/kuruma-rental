import { isSearchMapEnabled, resolveResultView } from '@/vite/search/flags'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('isSearchMapEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is OFF (beta default) when VITE_SEARCH_MAP_ENABLED is unset', () => {
    vi.stubEnv('VITE_SEARCH_MAP_ENABLED', undefined)
    expect(isSearchMapEnabled()).toBe(false)
  })

  it('is ON only for the exact string "true"', () => {
    vi.stubEnv('VITE_SEARCH_MAP_ENABLED', 'true')
    expect(isSearchMapEnabled()).toBe(true)
  })

  it("stays OFF for a typo'd, mis-cased, or empty value (fail-safe)", () => {
    for (const value of ['false', '1', 'TRUE', 'yes', '']) {
      vi.stubEnv('VITE_SEARCH_MAP_ENABLED', value)
      expect(isSearchMapEnabled()).toBe(false)
    }
  })
})

describe('resolveResultView', () => {
  it('keeps the map view when the map is enabled and explicitly requested', () => {
    expect(resolveResultView('map', true)).toBe('map')
  })

  it('defaults to the store list when no view is requested', () => {
    expect(resolveResultView(undefined, true)).toBe('stores')
    expect(resolveResultView('stores', true)).toBe('stores')
  })

  it('collapses a stale ?view=map link to the store list when the map is gated off (beta)', () => {
    expect(resolveResultView('map', false)).toBe('stores')
    expect(resolveResultView(undefined, false)).toBe('stores')
  })
})
