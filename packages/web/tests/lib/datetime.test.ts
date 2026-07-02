import {
  formatJstDateTimeLocal,
  formatJstTime,
  instantToJstFauxLocal,
  jstWallClockToInstant,
  parseJstDateTimeLocal,
  todayInJst,
} from '@/lib/datetime'
import { describe, expect, it } from 'vitest'

describe('parseJstDateTimeLocal', () => {
  it('interprets a datetime-local string as wall-clock JST, not browser TZ', () => {
    // Input: "2026-05-01T10:00" means 10:00 Tokyo wall clock.
    // Tokyo is UTC+9 year-round (no DST), so 10:00 JST = 01:00 UTC.
    // The ISO output is TZ-independent — it's always the same regardless of
    // where the browser lives.
    const d = parseJstDateTimeLocal('2026-05-01T10:00')
    expect(d.toISOString()).toBe('2026-05-01T01:00:00.000Z')
  })

  it('handles the with-seconds form from step=1 inputs', () => {
    const d = parseJstDateTimeLocal('2026-05-01T10:30:45')
    expect(d.toISOString()).toBe('2026-05-01T01:30:45.000Z')
  })

  it('rolls across the date boundary when the wall time is before 09:00 JST', () => {
    // 08:00 JST on May 1 is 23:00 UTC on April 30 — different day.
    const d = parseJstDateTimeLocal('2026-05-01T08:00')
    expect(d.toISOString()).toBe('2026-04-30T23:00:00.000Z')
  })

  it('produces a Date whose getTime() is deterministic across browser TZs', () => {
    // Two identical inputs should parse to the same millisecond value no
    // matter where they're invoked — that's the whole point of pinning JST.
    const a = parseJstDateTimeLocal('2026-05-01T10:00').getTime()
    const b = parseJstDateTimeLocal('2026-05-01T10:00').getTime()
    expect(a).toBe(b)
    // And the underlying epoch should match the documented JST→UTC conversion.
    expect(a).toBe(Date.UTC(2026, 4, 1, 1, 0, 0))
  })

  it('throws on a value the native Date parser rejects', () => {
    expect(() => parseJstDateTimeLocal('not-a-date')).toThrow(/invalid/i)
  })

  it('throws on an empty string rather than silently producing epoch', () => {
    expect(() => parseJstDateTimeLocal('')).toThrow(/invalid/i)
  })
})

describe('formatJstDateTimeLocal', () => {
  it('renders an instant as a JST wall-clock datetime-local string', () => {
    // 05:37 UTC = 14:37 Tokyo (UTC+9, no DST).
    expect(formatJstDateTimeLocal(new Date('2026-06-11T05:37:00Z'))).toBe('2026-06-11T14:37')
  })

  it('rolls the calendar date forward when JST crosses midnight', () => {
    // 23:30 UTC on May 1 = 08:30 JST on May 2.
    expect(formatJstDateTimeLocal(new Date('2026-05-01T23:30:00Z'))).toBe('2026-05-02T08:30')
  })

  it('zero-pads month, day, hour, and minute to two digits', () => {
    // 00:05 JST on Jan 3 = 15:05 UTC on Jan 2.
    expect(formatJstDateTimeLocal(new Date('2026-01-02T15:05:00Z'))).toBe('2026-01-03T00:05')
  })

  it('round-trips with parseJstDateTimeLocal at minute granularity', () => {
    const original = new Date('2026-07-01T01:00:00Z') // 10:00 JST
    const roundTripped = parseJstDateTimeLocal(formatJstDateTimeLocal(original))
    expect(roundTripped.getTime()).toBe(original.getTime())
  })
})

describe('formatJstTime', () => {
  // 05:30Z == 14:30 Asia/Tokyo — a PM instant that renders differently per locale,
  // so it proves the JST pin AND that the passed locale (not the ambient default)
  // drives the clock convention. This is the DRY-consolidated version of the pin
  // that was copy-pasted across TodayPanel + formatDateTime (#1308 recurrence guard).
  const AT = '2026-06-30T05:30:00.000Z'

  it('renders 24-hour time for ja at the JST wall clock', () => {
    expect(formatJstTime(AT, 'ja')).toBe('14:30')
  })

  it('renders 12-hour time (AM/PM) for en at the JST wall clock', () => {
    expect(formatJstTime(AT, 'en')).toMatch(/2:30\s?PM/i)
  })

  it('pins to Asia/Tokyo regardless of the instant offset (00:30Z == 09:30 JST)', () => {
    expect(formatJstTime('2026-06-30T00:30:00.000Z', 'ja')).toBe('09:30')
  })
})

// #1250: the calendar renders in JST regardless of browser TZ. The rbc/timeline libs
// position by a Date's *local* wall clock, so we (a) read a local wall clock AS JST to
// build the JST-anchored fetch window and un-shift clicked slots, and (b) rebuild an
// instant's JST wall clock as a local Date so a band lands at its Tokyo hour. These are
// inverses. Assertions read/write LOCAL fields on both sides, so they hold under any
// runner TZ (here: America/Toronto).

describe('jstWallClockToInstant', () => {
  it('reads a Date local wall clock as JST and returns the true instant (00:00 JST)', () => {
    // Local wall clock 2026-07-15 00:00 interpreted as JST midnight = 2026-07-14T15:00Z.
    const wall = new Date(2026, 6, 15, 0, 0, 0)
    expect(jstWallClockToInstant(wall).toISOString()).toBe('2026-07-14T15:00:00.000Z')
  })

  it('maps a 10:00 wall clock to 01:00Z (JST is UTC+9)', () => {
    expect(jstWallClockToInstant(new Date(2026, 6, 15, 10, 0, 0)).toISOString()).toBe(
      '2026-07-15T01:00:00.000Z',
    )
  })
})

describe('instantToJstFauxLocal', () => {
  it("rebuilds an instant's JST wall clock as a local Date (01:00Z -> local 10:00)", () => {
    const faux = instantToJstFauxLocal(new Date('2026-07-15T01:00:00.000Z'))
    expect([faux.getFullYear(), faux.getMonth(), faux.getDate()]).toEqual([2026, 6, 15])
    expect([faux.getHours(), faux.getMinutes()]).toEqual([10, 0])
  })

  it('rolls the local calendar day when JST crosses midnight (15:00Z -> next JST day 00:00)', () => {
    const faux = instantToJstFauxLocal(new Date('2026-07-15T15:00:00.000Z'))
    expect([faux.getFullYear(), faux.getMonth(), faux.getDate()]).toEqual([2026, 6, 16])
    expect([faux.getHours(), faux.getMinutes()]).toEqual([0, 0])
  })

  it('is the inverse of jstWallClockToInstant', () => {
    const instant = new Date('2026-07-15T18:23:00.000Z')
    expect(jstWallClockToInstant(instantToJstFauxLocal(instant)).getTime()).toBe(instant.getTime())
  })
})

describe('todayInJst', () => {
  it('returns the JST calendar day at local midnight (matching the JST wall-clock date of now)', () => {
    const today = todayInJst()
    expect([today.getHours(), today.getMinutes(), today.getSeconds()]).toEqual([0, 0, 0])
    const jstNow = instantToJstFauxLocal(new Date())
    expect([today.getFullYear(), today.getMonth(), today.getDate()]).toEqual([
      jstNow.getFullYear(),
      jstNow.getMonth(),
      jstNow.getDate(),
    ])
  })
})
