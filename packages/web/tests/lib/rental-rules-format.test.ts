import {
  formatDurationHours,
  hasAnyRentalRule,
  pickPrimaryRentalRule,
} from '@/lib/rental-rules-format'
import { describe, expect, it } from 'vitest'

// The translate function under test: mimics next-intl's ICU plural
// behaviour for the two keys this helper uses.
const t = (key: string, values: { count: number }) => {
  const { count } = values
  if (key === 'hours') return count === 1 ? `${count} hour` : `${count} hours`
  if (key === 'days') return count === 1 ? `${count} day` : `${count} days`
  return key
}

describe('formatDurationHours', () => {
  it('formats 1 hour with singular unit', () => {
    expect(formatDurationHours(1, t)).toBe('1 hour')
  })

  it('formats 4 hours as plural hours', () => {
    expect(formatDurationHours(4, t)).toBe('4 hours')
  })

  it('formats 24 hours as "1 day", not "24 hours"', () => {
    expect(formatDurationHours(24, t)).toBe('1 day')
  })

  it('formats 72 hours as "3 days"', () => {
    expect(formatDurationHours(72, t)).toBe('3 days')
  })

  it('formats 240 hours as "10 days"', () => {
    expect(formatDurationHours(240, t)).toBe('10 days')
  })

  it('keeps 36 hours in hours (not a clean day multiple)', () => {
    // Guessing "1.5 days" would confuse — stay honest and show hours.
    expect(formatDurationHours(36, t)).toBe('36 hours')
  })

  it('keeps 23 hours in hours', () => {
    expect(formatDurationHours(23, t)).toBe('23 hours')
  })
})

describe('hasAnyRentalRule', () => {
  it('returns false when all three are null', () => {
    expect(
      hasAnyRentalRule({
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
      }),
    ).toBe(false)
  })

  it('returns true when only min is set', () => {
    expect(
      hasAnyRentalRule({
        minRentalHours: 4,
        maxRentalHours: null,
        advanceBookingHours: null,
      }),
    ).toBe(true)
  })

  it('returns true when only max is set', () => {
    expect(
      hasAnyRentalRule({
        minRentalHours: null,
        maxRentalHours: 72,
        advanceBookingHours: null,
      }),
    ).toBe(true)
  })

  it('returns true when only advance is set', () => {
    expect(
      hasAnyRentalRule({
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: 24,
      }),
    ).toBe(true)
  })
})

describe('pickPrimaryRentalRule', () => {
  it('returns null when no rules are set', () => {
    expect(
      pickPrimaryRentalRule({
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
      }),
    ).toBeNull()
  })

  it('prefers advance over min over max', () => {
    expect(
      pickPrimaryRentalRule({
        minRentalHours: 4,
        maxRentalHours: 72,
        advanceBookingHours: 24,
      }),
    ).toEqual({ code: 'advance', hours: 24 })
  })

  it('prefers min over max when advance is unset', () => {
    expect(
      pickPrimaryRentalRule({
        minRentalHours: 4,
        maxRentalHours: 72,
        advanceBookingHours: null,
      }),
    ).toEqual({ code: 'min', hours: 4 })
  })

  it('falls back to max when it is the only rule', () => {
    expect(
      pickPrimaryRentalRule({
        minRentalHours: null,
        maxRentalHours: 72,
        advanceBookingHours: null,
      }),
    ).toEqual({ code: 'max', hours: 72 })
  })
})
