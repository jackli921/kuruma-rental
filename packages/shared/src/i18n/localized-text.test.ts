import { describe, expect, test } from 'vitest'

import {
  type LocalizedText,
  localizedTextOverrideSchema,
  localizedTextSchema,
  resolveDescription,
  resolveLocalized,
} from './localized-text'

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

/**
 * P1-a: an operator description override has a DIFFERENT invariant than a
 * template bundle — an operator may author one locale only, so NO locale (not
 * even en) is required, but the bundle must carry at least one key.
 */
describe('localizedTextOverrideSchema', () => {
  test('accepts a single-locale override (ja only, no en)', () => {
    expect(localizedTextOverrideSchema.parse({ ja: '編集済み' })).toEqual({ ja: '編集済み' })
  })

  test('rejects an empty object (at least one locale required)', () => {
    expect(localizedTextOverrideSchema.safeParse({}).success).toBe(false)
  })

  test('rejects unknown locale keys (strict)', () => {
    expect(localizedTextOverrideSchema.safeParse({ fr: 'non' }).success).toBe(false)
  })

  test('rejects an empty string value', () => {
    expect(localizedTextOverrideSchema.safeParse({ ja: '' }).success).toBe(false)
  })
})

/**
 * P1-a precedence: override[locale] -> template[locale] -> template.en -> null.
 * Per-locale fall-through — a ja-only override never leaks as a cross-locale
 * fallback for a zh reader.
 */
describe('resolveDescription', () => {
  const template: LocalizedText = {
    en: 'Fitted at pickup.',
    ja: '受け取り時に取り付け',
    zh: '取车时安装',
  }

  test('override for the requested locale wins over the template', () => {
    expect(resolveDescription({ ja: '当社で取り付け' }, template, 'ja')).toBe('当社で取り付け')
  })

  test('a ja-only override under a zh reader falls to the template zh, not the override ja', () => {
    expect(resolveDescription({ ja: '当社で取り付け' }, template, 'zh')).toBe('取车时安装')
  })

  test('falls to the template en when neither override nor template has the locale', () => {
    expect(resolveDescription({ ja: '当社で取り付け' }, { en: 'Fitted at pickup.' }, 'zh')).toBe(
      'Fitted at pickup.',
    )
  })

  test('a null override falls straight to the template', () => {
    expect(resolveDescription(null, template, 'ja')).toBe('受け取り時に取り付け')
  })

  test('returns null when both override and template are null', () => {
    expect(resolveDescription(null, null, 'ja')).toBeNull()
  })
})
