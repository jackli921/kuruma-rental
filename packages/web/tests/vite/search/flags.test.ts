import { isSearchMapEnabled } from '@/vite/search/flags'
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
