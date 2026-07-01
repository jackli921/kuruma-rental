import { describe, expect, test } from 'vitest'

import { jstDayRangeUtc } from './jst'

// JST is a fixed UTC+9 (no DST in Japan), so 00:00 JST of a calendar day is
// 15:00 UTC of the *previous* day. The range is half-open [startUtc, endUtc).
describe('jstDayRangeUtc', () => {
  test('midday instant maps to that JST day, 15:00-UTC-to-15:00-UTC bounds', () => {
    // 2026-07-01T05:00:00Z = 14:00 JST on 2026-07-01.
    const { startUtc, endUtc } = jstDayRangeUtc(new Date('2026-07-01T05:00:00.000Z'))
    expect(startUtc.toISOString()).toBe('2026-06-30T15:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-07-01T15:00:00.000Z')
  })

  test('23:30 JST resolves to its own JST day, not the next (the boundary case)', () => {
    // 2026-06-30T14:30:00Z = 23:30 JST on 2026-06-30 — must bucket into Jun 30.
    const { startUtc, endUtc } = jstDayRangeUtc(new Date('2026-06-30T14:30:00.000Z'))
    expect(startUtc.toISOString()).toBe('2026-06-29T15:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-06-30T15:00:00.000Z')
    // The 23:30-JST instant itself is inside [start, end).
    const start = new Date('2026-06-30T14:30:00.000Z')
    expect(start.getTime()).toBeGreaterThanOrEqual(startUtc.getTime())
    expect(start.getTime()).toBeLessThan(endUtc.getTime())
  })

  test('exactly 00:00 JST is the inclusive start of the new JST day', () => {
    // 2026-06-30T15:00:00Z = 00:00 JST on 2026-07-01.
    const { startUtc, endUtc } = jstDayRangeUtc(new Date('2026-06-30T15:00:00.000Z'))
    expect(startUtc.toISOString()).toBe('2026-06-30T15:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-07-01T15:00:00.000Z')
  })

  test('the window is exactly 24 hours', () => {
    const { startUtc, endUtc } = jstDayRangeUtc(new Date('2026-01-15T09:00:00.000Z'))
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000)
  })
})
