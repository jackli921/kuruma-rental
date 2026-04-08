import { describe, expect, test } from 'vitest'
import {
  classifyRoute,
  getLocaleFromPath,
  stripLocale,
} from '@/lib/route-helpers'

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
