import { describe, expect, test } from 'vitest'

import { slugify } from './slugify'

/**
 * `slugify` is the canonical key derivation shared by the catalog-template seed
 * (key = slugify of the canonical English name) and the backfill match/mint.
 * Its correctness is load-bearing: two distinct names must never collapse to one
 * key, or the backfill's intra-operator merge would ARCHIVE a live offering.
 */
describe('slugify', () => {
  test('lowercases and joins words with a single underscore', () => {
    expect(slugify('Child Seat')).toBe('child_seat')
  })

  test('collapses runs of whitespace/punctuation to one underscore', () => {
    expect(slugify('ETC  Card')).toBe('etc_card')
    expect(slugify('English GPS navigation')).toBe('english_gps_navigation')
  })

  test('trims and strips leading/trailing separators', () => {
    expect(slugify('  Pocket Wi-Fi  ')).toBe('pocket_wi_fi')
    expect(slugify('!Snow tires!')).toBe('snow_tires')
  })

  test('keeps digits', () => {
    expect(slugify('4WD kit')).toBe('4wd_kit')
  })

  test('preserves CJK letters as a distinct non-empty key (JP-market names)', () => {
    // \p{L} keeps CJK; an ASCII-only class would strip these to '' and merge
    // two different Japanese offerings into one archived template (data loss).
    expect(slugify('チャイルドシート')).toBe('チャイルドシート')
    expect(slugify('スノータイヤ')).toBe('スノータイヤ')
    expect(slugify('チャイルドシート')).not.toBe(slugify('スノータイヤ'))
  })

  test('an all-punctuation name gets a stable, non-empty fallback key', () => {
    const a = slugify('!!!')
    expect(a).not.toBe('')
    expect(a).toMatch(/^x_[a-z0-9]+$/)
    // deterministic: same input -> same key (idempotent backfill re-runs)
    expect(slugify('!!!')).toBe(a)
  })

  test('two distinct degenerate names never collapse to the same key', () => {
    expect(slugify('!!!')).not.toBe(slugify('???'))
  })
})
