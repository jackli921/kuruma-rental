import {
  classifyRoute,
  extractSessionRole,
  getLocaleFromPath,
  stripLocale,
} from '@/lib/route-helpers'
import { describe, expect, test } from 'vitest'

describe('stripLocale', () => {
  test('strips known locale prefix from path', () => {
    expect(stripLocale('/en/bookings')).toBe('/bookings')
    expect(stripLocale('/ja/dashboard')).toBe('/dashboard')
    expect(stripLocale('/zh/vehicles/123')).toBe('/vehicles/123')
  })

  test('returns path unchanged when no locale prefix', () => {
    expect(stripLocale('/bookings')).toBe('/bookings')
    expect(stripLocale('/')).toBe('/')
  })

  test('does not strip unknown locale-like segments', () => {
    expect(stripLocale('/fr/bookings')).toBe('/fr/bookings')
    expect(stripLocale('/de/vehicles')).toBe('/de/vehicles')
  })

  test('handles root locale path', () => {
    expect(stripLocale('/en')).toBe('/')
    expect(stripLocale('/ja')).toBe('/')
  })
})

describe('getLocaleFromPath', () => {
  test('extracts locale from path', () => {
    expect(getLocaleFromPath('/en/bookings')).toBe('en')
    expect(getLocaleFromPath('/ja/dashboard')).toBe('ja')
    expect(getLocaleFromPath('/zh')).toBe('zh')
  })

  test('returns default locale when no locale in path', () => {
    expect(getLocaleFromPath('/bookings')).toBe('en')
    expect(getLocaleFromPath('/')).toBe('en')
  })

  test('returns default locale for unknown locale prefix', () => {
    expect(getLocaleFromPath('/fr/bookings')).toBe('en')
  })
})

describe('classifyRoute', () => {
  test('identifies renter-protected paths', () => {
    const result = classifyRoute('/bookings')
    expect(result).toEqual({ type: 'renter' })
  })

  test('identifies renter paths with subpaths', () => {
    expect(classifyRoute('/bookings/abc-123')).toEqual({ type: 'renter' })
    expect(classifyRoute('/messages/thread-1')).toEqual({ type: 'renter' })
  })

  test('identifies business-protected paths with /manage/ prefix', () => {
    expect(classifyRoute('/manage/bookings')).toEqual({ type: 'business' })
    expect(classifyRoute('/manage/vehicles')).toEqual({ type: 'business' })
    expect(classifyRoute('/manage/vehicles/new')).toEqual({ type: 'business' })
    expect(classifyRoute('/manage/customers')).toEqual({ type: 'business' })
    expect(classifyRoute('/manage/messages')).toEqual({ type: 'business' })
  })

  test('identifies dashboard as business path', () => {
    expect(classifyRoute('/dashboard')).toEqual({ type: 'business' })
  })

  test('identifies public paths', () => {
    expect(classifyRoute('/')).toEqual({ type: 'public' })
    expect(classifyRoute('/vehicles')).toEqual({ type: 'public' })
    expect(classifyRoute('/vehicles/123')).toEqual({ type: 'public' })
    expect(classifyRoute('/login')).toEqual({ type: 'public' })
    expect(classifyRoute('/register')).toEqual({ type: 'public' })
  })
})

describe('extractSessionRole', () => {
  // Regression guard for issue #22: middleware crashed with
  // "Cannot read properties of undefined (reading 'role')" when visiting
  // business routes like /manage/messages because session.user was undefined.

  test('returns role when session.user.role is a non-empty string', () => {
    expect(extractSessionRole({ user: { role: 'ADMIN' } })).toBe('ADMIN')
    expect(extractSessionRole({ user: { role: 'STAFF' } })).toBe('STAFF')
    expect(extractSessionRole({ user: { role: 'RENTER' } })).toBe('RENTER')
  })

  test('returns null when session is null or undefined', () => {
    expect(extractSessionRole(null)).toBeNull()
    expect(extractSessionRole(undefined)).toBeNull()
  })

  test('returns null when session.user is undefined (CF Workers case)', () => {
    // On CF Workers, auth() can return a session where user is undefined.
    // This was the crash cause in #22.
    expect(extractSessionRole({ user: undefined })).toBeNull()
    expect(extractSessionRole({})).toBeNull()
  })

  test('returns null when session.user is null', () => {
    expect(extractSessionRole({ user: null })).toBeNull()
  })

  test('returns null when role is missing', () => {
    expect(extractSessionRole({ user: {} })).toBeNull()
    expect(extractSessionRole({ user: { role: undefined } })).toBeNull()
  })

  test('returns null when role is not a string', () => {
    expect(extractSessionRole({ user: { role: 123 } })).toBeNull()
    expect(extractSessionRole({ user: { role: null } })).toBeNull()
    expect(extractSessionRole({ user: { role: {} } })).toBeNull()
  })

  test('returns null when role is an empty string', () => {
    expect(extractSessionRole({ user: { role: '' } })).toBeNull()
  })
})
