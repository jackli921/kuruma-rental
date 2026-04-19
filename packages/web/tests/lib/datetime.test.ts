import { parseJstDateTimeLocal } from '@/lib/datetime'
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
