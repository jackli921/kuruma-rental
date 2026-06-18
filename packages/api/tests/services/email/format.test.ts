import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration } from '../../../src/services/email/templates/format'

// #680: a pickup/return is a location-anchored event the renter acts on while standing
// in Japan, and email can't detect the recipient's own timezone — so booking datetimes
// render in the pickup location's wall-clock time (JST, Asia/Tokyo, fixed UTC+9; Japan
// observes no DST), always labelled, never a bare or UTC time. These pin the exact
// rendered string so a mutant that reverts to UTC, uses the wrong offset, mishandles a
// date rollover, or prints 24:00 at midnight fails.

describe('formatDateTime', () => {
  it('renders an instant in JST wall-clock with an explicit label', () => {
    // 01:00 UTC + 9h = 10:00 JST, same calendar day.
    expect(formatDateTime(new Date('2026-07-01T01:00:00Z'))).toBe('2026-07-01 10:00 JST')
  })

  it('rolls the date forward when +9h crosses midnight', () => {
    // 18:00 UTC + 9h = 03:00 the NEXT day (this is the real booking endAt fixture).
    expect(formatDateTime(new Date('2026-07-03T18:00:00Z'))).toBe('2026-07-04 03:00 JST')
  })

  it('prints midnight as 00:00 (not 24:00) and rolls month/day', () => {
    // 15:30 UTC on Jun 30 + 9h = 00:30 JST on Jul 1.
    expect(formatDateTime(new Date('2026-06-30T15:30:00Z'))).toBe('2026-07-01 00:30 JST')
  })

  it('is no longer a UTC rendering', () => {
    const out = formatDateTime(new Date('2026-07-01T10:00:00Z'))
    expect(out).not.toContain('UTC')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} JST$/)
  })
})

// #960: the operator alert shows the rental LENGTH (not just the start/end range).
// Hourly granularity -> whole days + leftover hours, with locale unit labels, and
// a zero component dropped so a clean 3-day rental reads "3d", not "3d 0h".
const UNITS = { dayUnit: 'd', hourUnit: 'h' }

describe('formatDuration', () => {
  it('renders days and leftover hours together', () => {
    // 2026-07-01 10:00Z -> 2026-07-03 18:00Z = 56h = 2 days 8 hours
    expect(
      formatDuration(new Date('2026-07-01T10:00:00Z'), new Date('2026-07-03T18:00:00Z'), UNITS),
    ).toBe('2d 8h')
  })

  it('drops the hour component for a whole-day span', () => {
    // exactly 72h
    expect(
      formatDuration(new Date('2026-07-01T09:00:00Z'), new Date('2026-07-04T09:00:00Z'), UNITS),
    ).toBe('3d')
  })

  it('renders hours only for a sub-day span', () => {
    expect(
      formatDuration(new Date('2026-07-01T09:00:00Z'), new Date('2026-07-01T18:00:00Z'), UNITS),
    ).toBe('9h')
  })

  it('uses the supplied locale unit labels', () => {
    expect(
      formatDuration(new Date('2026-07-01T10:00:00Z'), new Date('2026-07-03T18:00:00Z'), {
        dayUnit: '日',
        hourUnit: '時間',
      }),
    ).toBe('2日 8時間')
  })
})
