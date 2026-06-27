import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLocalStorage, writeLocalStorage } from './safe-storage'

describe('safe-storage', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('reads a stored value through to localStorage', () => {
    localStorage.setItem('k', 'v')
    expect(readLocalStorage('k')).toBe('v')
  })

  it('returns null for a missing key', () => {
    expect(readLocalStorage('absent')).toBeNull()
  })

  it('returns null instead of throwing when getItem throws (Safari block-cookies / sandboxed webview)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: localStorage is not available')
      },
    })
    expect(readLocalStorage('k')).toBeNull()
  })

  it('persists a value through to localStorage', () => {
    writeLocalStorage('k2', 'v2')
    expect(localStorage.getItem('k2')).toBe('v2')
  })

  it('swallows a throwing setItem instead of crashing the caller', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => writeLocalStorage('k', 'v')).not.toThrow()
  })
})
