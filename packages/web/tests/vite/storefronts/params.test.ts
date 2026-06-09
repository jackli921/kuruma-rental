import { normalizeClassFilter, parseSearchRange } from '@/vite/storefronts/params'
import { describe, expect, it } from 'vitest'

describe('parseSearchRange', () => {
  it('parses a valid from/to pair as a JST wall-clock range', () => {
    const range = parseSearchRange('2026-07-01T10:00', '2026-07-03T10:00')
    expect(range).not.toBeNull()
    expect(range?.from.toISOString()).toBe('2026-07-01T01:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-07-03T01:00:00.000Z')
  })

  it('returns null when either bound is missing', () => {
    expect(parseSearchRange(undefined, '2026-07-03T10:00')).toBeNull()
    expect(parseSearchRange('2026-07-01T10:00', undefined)).toBeNull()
  })

  it('returns null when the range is non-positive (to <= from)', () => {
    expect(parseSearchRange('2026-07-03T10:00', '2026-07-01T10:00')).toBeNull()
    expect(parseSearchRange('2026-07-01T10:00', '2026-07-01T10:00')).toBeNull()
  })

  it('returns null for a malformed bound instead of throwing', () => {
    expect(parseSearchRange('not-a-date', '2026-07-03T10:00')).toBeNull()
  })
})

describe('normalizeClassFilter', () => {
  it('returns an empty array when absent', () => {
    expect(normalizeClassFilter(undefined)).toEqual([])
  })

  it('wraps a single code in an array', () => {
    expect(normalizeClassFilter('ECMR')).toEqual(['ECMR'])
  })

  it('passes an array of codes through unchanged', () => {
    expect(normalizeClassFilter(['ECMR', 'CDMR'])).toEqual(['ECMR', 'CDMR'])
  })
})
