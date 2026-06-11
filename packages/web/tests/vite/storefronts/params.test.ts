import {
  defaultSearchRange,
  normalizeClassFilter,
  parseSearchRange,
  searchRangeToSeed,
} from '@/vite/storefronts/params'
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

describe('defaultSearchRange', () => {
  it('starts at the next whole JST hour and returns three days later', () => {
    // 05:37 UTC = 14:37 JST -> ceil to 15:00 JST; +3 days = same wall clock.
    const range = defaultSearchRange(new Date('2026-06-11T05:37:00Z'))
    expect(range).toEqual({ from: '2026-06-11T15:00', to: '2026-06-14T15:00' })
  })

  it('keeps an instant that already sits on the hour boundary', () => {
    // 06:00 UTC = 15:00 JST exactly -> no skip to 16:00.
    const range = defaultSearchRange(new Date('2026-06-11T06:00:00Z'))
    expect(range.from).toBe('2026-06-11T15:00')
  })

  it('produces a positive, parseable range', () => {
    const range = defaultSearchRange(new Date('2026-06-11T05:37:00Z'))
    expect(parseSearchRange(range.from, range.to)).not.toBeNull()
  })
})

describe('searchRangeToSeed', () => {
  const now = new Date('2026-06-11T05:37:00Z')

  it('returns null when both bounds are already present', () => {
    expect(searchRangeToSeed({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' }, now)).toBeNull()
  })

  it('seeds defaults when the from bound is missing', () => {
    expect(searchRangeToSeed({ to: '2026-07-03T10:00' }, now)).toEqual(defaultSearchRange(now))
  })

  it('seeds defaults when the to bound is missing', () => {
    expect(searchRangeToSeed({ from: '2026-07-01T10:00' }, now)).toEqual(defaultSearchRange(now))
  })

  it('seeds defaults when both bounds are absent', () => {
    expect(searchRangeToSeed({}, now)).toEqual(defaultSearchRange(now))
  })
})
