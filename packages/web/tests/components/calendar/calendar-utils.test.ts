import {
  SOURCE_COLORS,
  SOURCE_LABELS,
  bookingToWeekPosition,
  getHourSlots,
  getMonthRange,
  getWeekRange,
  splitMultiDayBooking,
} from '@/components/calendar/calendar-utils'
import { describe, expect, it } from 'vitest'

/** Parse ISO string back to local Date and check date components. */
function expectLocalDate(iso: string, year: number, month: number, day: number): void {
  const d = new Date(iso)
  expect(d.getFullYear()).toBe(year)
  expect(d.getMonth() + 1).toBe(month) // getMonth is 0-indexed
  expect(d.getDate()).toBe(day)
}

describe('getWeekRange', () => {
  it('returns Monday-Sunday range for a Wednesday', () => {
    // 2026-04-08 is a Wednesday
    const date = new Date(2026, 3, 8) // April 8, 2026
    const range = getWeekRange(date)

    // Monday April 6
    expectLocalDate(range.from, 2026, 4, 6)
    // Sunday April 12
    expectLocalDate(range.to, 2026, 4, 12)
  })

  it('returns same week when given a Monday', () => {
    const monday = new Date(2026, 3, 6) // April 6, 2026 (Monday)
    const range = getWeekRange(monday)

    expectLocalDate(range.from, 2026, 4, 6)
    expectLocalDate(range.to, 2026, 4, 12)
  })

  it('returns same week when given a Sunday', () => {
    const sunday = new Date(2026, 3, 12) // April 12, 2026 (Sunday)
    const range = getWeekRange(sunday)

    expectLocalDate(range.from, 2026, 4, 6)
    expectLocalDate(range.to, 2026, 4, 12)
  })
})

describe('getMonthRange', () => {
  it('returns correct range for a 31-day month (January)', () => {
    const date = new Date(2026, 0, 15) // January 15
    const range = getMonthRange(date)

    expectLocalDate(range.from, 2026, 1, 1)
    expectLocalDate(range.to, 2026, 1, 31)
  })

  it('returns correct range for a 30-day month (April)', () => {
    const date = new Date(2026, 3, 10) // April 10
    const range = getMonthRange(date)

    expectLocalDate(range.from, 2026, 4, 1)
    expectLocalDate(range.to, 2026, 4, 30)
  })

  it('returns correct range for February (28 days in 2026)', () => {
    const date = new Date(2026, 1, 14) // February 14
    const range = getMonthRange(date)

    expectLocalDate(range.from, 2026, 2, 1)
    expectLocalDate(range.to, 2026, 2, 28)
  })

  it('returns correct range for February in leap year (29 days in 2028)', () => {
    const date = new Date(2028, 1, 14) // February 14, 2028
    const range = getMonthRange(date)

    expectLocalDate(range.from, 2028, 2, 1)
    expectLocalDate(range.to, 2028, 2, 29)
  })
})

describe('getHourSlots', () => {
  it('returns exactly 24 items', () => {
    const slots = getHourSlots()
    expect(slots).toHaveLength(24)
  })

  it('starts with 00:00 and ends with 23:00', () => {
    const slots = getHourSlots()
    expect(slots[0]).toBe('00:00')
    expect(slots[23]).toBe('23:00')
  })

  it('has correct format for all entries', () => {
    const slots = getHourSlots()
    for (const slot of slots) {
      expect(slot).toMatch(/^\d{2}:00$/)
    }
  })

  it('contains specific mid-day values', () => {
    const slots = getHourSlots()
    expect(slots[12]).toBe('12:00')
    expect(slots[6]).toBe('06:00')
    expect(slots[18]).toBe('18:00')
  })
})

describe('bookingToWeekPosition', () => {
  it('returns correct top and height for a 2-hour booking at 10:00', () => {
    // dayStart = April 8, 2026 at midnight
    const dayStart = new Date(2026, 3, 8, 0, 0, 0)
    const startAt = new Date(2026, 3, 8, 10, 0, 0).toISOString()
    const endAt = new Date(2026, 3, 8, 12, 0, 0).toISOString()

    const pos = bookingToWeekPosition(startAt, endAt, dayStart)

    // 10 hours * 48px = 480
    expect(pos.top).toBe(480)
    // 2 hours * 48px = 96
    expect(pos.height).toBe(96)
  })

  it('returns correct position for a 30-minute booking', () => {
    const dayStart = new Date(2026, 3, 8, 0, 0, 0)
    const startAt = new Date(2026, 3, 8, 14, 0, 0).toISOString()
    const endAt = new Date(2026, 3, 8, 14, 30, 0).toISOString()

    const pos = bookingToWeekPosition(startAt, endAt, dayStart)

    // 14 hours * 48px = 672
    expect(pos.top).toBe(672)
    // 30 min = 0.5 hours * 48px = 24
    expect(pos.height).toBe(24)
  })

  it('clamps booking that starts before midnight to top=0', () => {
    const dayStart = new Date(2026, 3, 8, 0, 0, 0)
    // Booking starts previous day at 22:00
    const startAt = new Date(2026, 3, 7, 22, 0, 0).toISOString()
    const endAt = new Date(2026, 3, 8, 3, 0, 0).toISOString()

    const pos = bookingToWeekPosition(startAt, endAt, dayStart)

    expect(pos.top).toBe(0)
    // 3 hours * 48px = 144
    expect(pos.height).toBe(144)
  })

  it('clamps booking that ends after 23:59 to day boundary', () => {
    const dayStart = new Date(2026, 3, 8, 0, 0, 0)
    const startAt = new Date(2026, 3, 8, 22, 0, 0).toISOString()
    // Booking ends next day at 3:00
    const endAt = new Date(2026, 3, 9, 3, 0, 0).toISOString()

    const pos = bookingToWeekPosition(startAt, endAt, dayStart)

    // 22 hours * 48px = 1056
    expect(pos.top).toBe(1056)
    // Clamped to end of day: 24-22 = 2 hours * 48px = 96
    // Actually 23:59:59.999 - 22:00 ~= 2 hours
    expect(pos.height).toBeCloseTo(96, -1)
  })
})

describe('splitMultiDayBooking', () => {
  it('splits a 3-day booking into 3 segments', () => {
    const booking = {
      startAt: new Date(2026, 3, 8, 14, 0, 0).toISOString(), // Apr 8 14:00
      endAt: new Date(2026, 3, 10, 10, 0, 0).toISOString(), // Apr 10 10:00
    }
    const rangeStart = new Date(2026, 3, 6) // Monday Apr 6
    const rangeEnd = new Date(2026, 3, 12, 23, 59, 59) // Sunday Apr 12

    const segments = splitMultiDayBooking(booking, rangeStart, rangeEnd)

    expect(segments).toHaveLength(3)

    // Day 1: Apr 8, 14:00 - 24:00, isStart=true, isEnd=false
    expect(segments[0]!.startHour).toBe(14)
    expect(segments[0]!.endHour).toBe(24)
    expect(segments[0]!.isStart).toBe(true)
    expect(segments[0]!.isEnd).toBe(false)

    // Day 2: Apr 9, 0:00 - 24:00, isStart=false, isEnd=false
    expect(segments[1]!.startHour).toBe(0)
    expect(segments[1]!.endHour).toBe(24)
    expect(segments[1]!.isStart).toBe(false)
    expect(segments[1]!.isEnd).toBe(false)

    // Day 3: Apr 10, 0:00 - 10:00, isStart=false, isEnd=true
    expect(segments[2]!.startHour).toBe(0)
    expect(segments[2]!.endHour).toBe(10)
    expect(segments[2]!.isStart).toBe(false)
    expect(segments[2]!.isEnd).toBe(true)
  })

  it('returns a single segment for a booking within one day', () => {
    const booking = {
      startAt: new Date(2026, 3, 8, 9, 0, 0).toISOString(), // Apr 8 09:00
      endAt: new Date(2026, 3, 8, 17, 0, 0).toISOString(), // Apr 8 17:00
    }
    const rangeStart = new Date(2026, 3, 6)
    const rangeEnd = new Date(2026, 3, 12, 23, 59, 59)

    const segments = splitMultiDayBooking(booking, rangeStart, rangeEnd)

    expect(segments).toHaveLength(1)
    expect(segments[0]!.startHour).toBe(9)
    expect(segments[0]!.endHour).toBe(17)
    expect(segments[0]!.isStart).toBe(true)
    expect(segments[0]!.isEnd).toBe(true)
  })

  it('clips booking to visible range when booking extends beyond range', () => {
    const booking = {
      startAt: new Date(2026, 3, 5, 10, 0, 0).toISOString(), // Apr 5 (before range)
      endAt: new Date(2026, 3, 14, 10, 0, 0).toISOString(), // Apr 14 (after range)
    }
    const rangeStart = new Date(2026, 3, 6)
    const rangeEnd = new Date(2026, 3, 12, 23, 59, 59)

    const segments = splitMultiDayBooking(booking, rangeStart, rangeEnd)

    // Should have 7 segments (Apr 6-12)
    expect(segments).toHaveLength(7)
    // First segment starts at 0 (clipped from before range)
    expect(segments[0]!.startHour).toBe(0)
    expect(segments[0]!.isStart).toBe(false)
    // Last segment ends at 24 (clipped from after range)
    expect(segments[6]!.endHour).toBe(24)
    expect(segments[6]!.isEnd).toBe(false)
  })
})

describe('SOURCE_COLORS', () => {
  it('has all 4 sources', () => {
    expect(Object.keys(SOURCE_COLORS)).toHaveLength(4)
    expect(SOURCE_COLORS).toHaveProperty('DIRECT')
    expect(SOURCE_COLORS).toHaveProperty('TRIP_COM')
    expect(SOURCE_COLORS).toHaveProperty('MANUAL')
    expect(SOURCE_COLORS).toHaveProperty('OTHER')
  })

  it('each source has bg and text properties', () => {
    for (const [, colors] of Object.entries(SOURCE_COLORS)) {
      expect(colors).toHaveProperty('bg')
      expect(colors).toHaveProperty('text')
      expect(typeof colors.bg).toBe('string')
      expect(typeof colors.text).toBe('string')
    }
  })
})

describe('SOURCE_LABELS', () => {
  it('has all 4 sources with correct display labels', () => {
    expect(SOURCE_LABELS).toEqual({
      DIRECT: 'Direct',
      TRIP_COM: 'Trip.com',
      MANUAL: 'Manual',
      OTHER: 'Other',
    })
  })
})
