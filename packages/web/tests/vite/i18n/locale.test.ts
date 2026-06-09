import { DEFAULT_LOCALE, detectLocale, isLocale } from '@/vite/i18n/locale'
import { describe, expect, it } from 'vitest'

describe('isLocale', () => {
  it('accepts supported locales and rejects anything else', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('ja')).toBe(true)
    expect(isLocale('zh')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('detectLocale', () => {
  it('uses a valid NEXT_LOCALE cookie first', () => {
    expect(detectLocale({ cookie: 'ja', languages: ['en-US'] })).toBe('ja')
  })

  it('ignores an invalid cookie and falls back to navigator languages', () => {
    expect(detectLocale({ cookie: 'xx', languages: ['ja-JP', 'en'] })).toBe('ja')
  })

  it('matches the first navigator language by base prefix', () => {
    expect(detectLocale({ languages: ['fr-FR', 'zh-CN', 'en'] })).toBe('zh')
  })

  it('is case-insensitive on the navigator prefix', () => {
    expect(detectLocale({ languages: ['ZH-hant'] })).toBe('zh')
  })

  it(`defaults to ${DEFAULT_LOCALE} when no signal resolves`, () => {
    expect(detectLocale({})).toBe('en')
    expect(detectLocale({ cookie: null, languages: ['fr', 'de'] })).toBe('en')
  })
})
