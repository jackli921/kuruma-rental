import { describe, expect, test } from 'vitest'

import { type LocalizedText, localizedTextSchema, resolveLocalized } from './localized-text'

/**
 * `localizedTextSchema` is the one schema behind every catalog template name /
 * description bundle and operator description override. `en` is required (the
 * guaranteed fallback), other locales optional, every present value non-empty,
 * unknown keys rejected. `resolveLocalized` picks the caller's locale or falls
 * back to `en` — the seam that keeps every read path rendering plain strings.
 */
describe('localizedTextSchema', () => {
  test('accepts an en-only bundle', () => {
    const parsed = localizedTextSchema.parse({ en: 'Child seat' })
    expect(parsed).toEqual({ en: 'Child seat' })
  })

  test('accepts a fully-populated bundle', () => {
    const bundle = { en: 'Child seat', ja: 'チャイルドシート', zh: '儿童座椅' }
    expect(localizedTextSchema.parse(bundle)).toEqual(bundle)
  })

  test('rejects a bundle missing en', () => {
    expect(localizedTextSchema.safeParse({ ja: 'チャイルドシート' }).success).toBe(false)
  })

  test('rejects an empty string in any present locale', () => {
    expect(localizedTextSchema.safeParse({ en: '' }).success).toBe(false)
    expect(localizedTextSchema.safeParse({ en: 'ok', ja: '' }).success).toBe(false)
  })

  test('rejects unknown locale keys (strict)', () => {
    expect(localizedTextSchema.safeParse({ en: 'ok', fr: 'non' }).success).toBe(false)
  })
})

describe('resolveLocalized', () => {
  const bundle: LocalizedText = { en: 'Child seat', ja: 'チャイルドシート', zh: '儿童座椅' }

  test('returns the requested locale when present', () => {
    expect(resolveLocalized(bundle, 'ja')).toBe('チャイルドシート')
    expect(resolveLocalized(bundle, 'zh')).toBe('儿童座椅')
  })

  test('falls back to en when the requested locale is absent', () => {
    expect(resolveLocalized({ en: 'Child seat' }, 'ja')).toBe('Child seat')
  })

  test('returns en for the en locale', () => {
    expect(resolveLocalized(bundle, 'en')).toBe('Child seat')
  })
})
