import { getViewMode, isBusiness, resolveViewMode, setViewMode } from '@/vite/view-mode'
import { beforeEach, describe, expect, it } from 'vitest'

const OWNER = 'OPERATOR_OWNER'
const RENTER = 'RENTER'

function clearCookies(): void {
  for (const pair of document.cookie.split('; ')) {
    const name = pair.split('=')[0]
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
}

describe('isBusiness', () => {
  it('is true for every business role', () => {
    for (const role of ['STAFF', 'ADMIN', 'PLATFORM_ADMIN', 'OPERATOR_OWNER', 'OPERATOR_STAFF']) {
      expect(isBusiness(role)).toBe(true)
    }
  })

  it('is false for renters and unauthenticated users', () => {
    expect(isBusiness(RENTER)).toBe(false)
    expect(isBusiness(undefined)).toBe(false)
  })
})

describe('resolveViewMode (pure)', () => {
  it('forces renters to the renter view regardless of the cookie', () => {
    expect(resolveViewMode(RENTER, 'business')).toBe('renter')
    expect(resolveViewMode(undefined, 'business')).toBe('renter')
  })

  it('defaults business users to the business view when no cookie is set', () => {
    expect(resolveViewMode(OWNER, undefined)).toBe('business')
  })

  it('lets a business user opt into the renter view via the cookie', () => {
    expect(resolveViewMode(OWNER, 'renter')).toBe('renter')
  })

  it('ignores a malformed cookie value and stays on the business view', () => {
    expect(resolveViewMode(OWNER, 'garbage')).toBe('business')
  })
})

describe('getViewMode / setViewMode round-trip', () => {
  beforeEach(clearCookies)

  it('persists a business user opting into the renter view', () => {
    setViewMode('renter')
    expect(getViewMode(OWNER)).toBe('renter')
  })

  it('persists a business user switching back to the business view', () => {
    setViewMode('renter')
    setViewMode('business')
    expect(getViewMode(OWNER)).toBe('business')
  })

  it('writes a JS-readable (non-httpOnly) cookie so the SPA can read it back', () => {
    setViewMode('renter')
    expect(document.cookie).toContain('kuruma-view=renter')
  })

  it('never lets a renter be forced into the business view by a stale cookie', () => {
    setViewMode('business')
    expect(getViewMode(RENTER)).toBe('renter')
  })
})
