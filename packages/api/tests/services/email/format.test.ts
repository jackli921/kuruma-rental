import { describe, expect, it } from 'vitest'
import { formatDateTime } from '../../../src/services/email/templates/format'

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
