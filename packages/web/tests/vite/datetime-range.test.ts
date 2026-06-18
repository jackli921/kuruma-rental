import {
  combineDateTime,
  fromLocalDate,
  generateTimeSlots,
  isPastDate,
  jstNowParts,
  rentalDays,
  slotsForDate,
  splitDateTime,
  toLocalDate,
} from '@/vite/search/datetime-range'
import { describe, expect, it } from 'vitest'

describe('splitDateTime', () => {
  it('splits a JST wall-clock string into date and time parts', () => {
    expect(splitDateTime('2026-06-17T10:30')).toEqual({ date: '2026-06-17', time: '10:30' })
  })

  it('ignores a trailing seconds component', () => {
    expect(splitDateTime('2026-06-17T10:30:00')).toEqual({ date: '2026-06-17', time: '10:30' })
  })

  it('returns null for a malformed value', () => {
    expect(splitDateTime('not-a-date')).toBeNull()
    expect(splitDateTime('')).toBeNull()
  })
})

describe('combineDateTime', () => {
  it('rebuilds the datetime-local string the API contract expects', () => {
    expect(combineDateTime('2026-06-17', '10:30')).toBe('2026-06-17T10:30')
  })

  it('round-trips with splitDateTime', () => {
    const s = '2026-12-31T23:30'
    const parts = splitDateTime(s)
    expect(parts).not.toBeNull()
    expect(combineDateTime(parts!.date, parts!.time)).toBe(s)
  })
})

describe('generateTimeSlots', () => {
  it('produces 48 half-hour slots from 00:00 to 23:30', () => {
    const slots = generateTimeSlots(30)
    expect(slots).toHaveLength(48)
    expect(slots[0]).toBe('00:00')
    expect(slots[47]).toBe('23:30')
    expect(slots).toContain('09:30')
  })

  it('produces 24 hourly slots when stepped by 60', () => {
    const slots = generateTimeSlots(60)
    expect(slots).toHaveLength(24)
    expect(slots[1]).toBe('01:00')
  })
})

describe('jstNowParts', () => {
  it('reads the Tokyo wall clock regardless of UTC instant', () => {
    expect(jstNowParts(new Date('2026-06-17T01:00:00Z'))).toEqual({
      date: '2026-06-17',
      time: '10:00',
    })
  })

  it('rolls to the next JST day for a late-UTC instant', () => {
    // 20:00Z = 05:00 next-day JST
    expect(jstNowParts(new Date('2026-06-16T20:00:00Z')).date).toBe('2026-06-17')
  })
})

describe('isPastDate', () => {
  const now = new Date('2026-06-17T01:00:00Z') // JST 2026-06-17 10:00

  it('flags a calendar date before today (JST)', () => {
    expect(isPastDate('2026-06-16', now)).toBe(true)
  })

  it('treats today and future as not past', () => {
    expect(isPastDate('2026-06-17', now)).toBe(false)
    expect(isPastDate('2026-06-18', now)).toBe(false)
  })
})

describe('slotsForDate', () => {
  const now = new Date('2026-06-17T01:15:00Z') // JST 10:15

  it('returns every slot for a future date', () => {
    expect(slotsForDate('2026-06-18', now, 30)).toHaveLength(48)
  })

  it('drops slots earlier than now on today (JST)', () => {
    const slots = slotsForDate('2026-06-17', now, 30)
    expect(slots).not.toContain('10:00')
    expect(slots[0]).toBe('10:30')
  })

  it('returns nothing for a past date', () => {
    expect(slotsForDate('2026-06-16', now, 30)).toEqual([])
  })
})

describe('toLocalDate / fromLocalDate', () => {
  it('maps a date string to a local-midnight Date and back', () => {
    const d = toLocalDate('2026-06-17')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(17)
    expect(fromLocalDate(d)).toBe('2026-06-17')
  })
})

describe('rentalDays', () => {
  it('counts whole rental days, rounding up partial days', () => {
    expect(rentalDays({ from: '2026-06-17T10:00', to: '2026-06-19T10:00' })).toBe(2)
    expect(rentalDays({ from: '2026-06-17T10:00', to: '2026-06-17T12:00' })).toBe(1)
  })

  it('returns 0 for a non-positive or invalid range', () => {
    expect(rentalDays({ from: '2026-06-17T10:00', to: '2026-06-17T10:00' })).toBe(0)
    expect(rentalDays({ from: 'bad', to: 'bad' })).toBe(0)
  })
})
