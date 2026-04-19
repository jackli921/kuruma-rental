import { describe, expect, test } from 'bun:test'
import { flattenKeys, reportParity } from './lint-i18n-parity'

describe('flattenKeys', () => {
  test('flattens nested objects with dot-joined paths', () => {
    const keys = flattenKeys({ a: { b: { c: 'x' } }, d: 'y' })
    expect([...keys].sort()).toEqual(['a.b.c', 'd'])
  })

  test('treats arrays and primitives as leaf values', () => {
    const keys = flattenKeys({ list: ['a', 'b'], n: 1, b: true, nil: null })
    expect([...keys].sort()).toEqual(['b', 'list', 'n', 'nil'])
  })

  test('returns empty set for an empty object', () => {
    expect([...flattenKeys({})]).toEqual([])
  })
})

describe('reportParity', () => {
  test('empty missingByLocale when every locale has the same keys', () => {
    const r = reportParity({
      en: new Set(['a', 'b']),
      ja: new Set(['a', 'b']),
    })
    expect(r.keyCount).toBe(2)
    expect(r.missingByLocale).toEqual({})
  })

  test('reports each locale missing keys present in another', () => {
    const r = reportParity({
      en: new Set(['a', 'b', 'c']),
      ja: new Set(['a', 'b']),
      zh: new Set(['a']),
    })
    expect(r.keyCount).toBe(3)
    expect(r.missingByLocale).toEqual({
      ja: ['c'],
      zh: ['b', 'c'],
    })
  })

  test('locales are reported in sorted order for deterministic output', () => {
    const r = reportParity({
      zh: new Set(['a']),
      en: new Set(['a']),
      ja: new Set(['a']),
    })
    expect(r.locales).toEqual(['en', 'ja', 'zh'])
  })
})
