import {
  combineDateTime,
  ensureEndAfterStart,
  fromLocalDate,
  generateTimeSlots,
  isPastDate,
  jstNowParts,
  rentalDays,
  resolveSlot,
  returnSlotsForDate,
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

describe('resolveSlot', () => {
  const now = new Date('2026-06-17T01:15:00Z') // JST 10:15

  it('keeps a still-selectable time on a future date', () => {
    expect(resolveSlot('2026-06-18', '08:00', now, 30)).toBe('08:00')
  })

  it('clamps a now-past time to the first selectable slot on today', () => {
    // 08:00 is earlier than now (10:15) on today → first slot is 10:30.
    expect(resolveSlot('2026-06-17', '08:00', now, 30)).toBe('10:30')
  })

  it('falls back to the first slot when there is no prior time', () => {
    expect(resolveSlot('2026-06-18', null, now, 30)).toBe('00:00')
  })

  it('returns "00:00" defensively for a fully-past date with no slots', () => {
    expect(resolveSlot('2026-06-16', '08:00', now, 30)).toBe('00:00')
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

describe('returnSlotsForDate', () => {
  const now = new Date('2026-06-17T01:15:00Z') // JST 10:15

  it('returns the full slot list when the return is on a later day than pickup', () => {
    const slots = returnSlotsForDate('2026-06-19', { date: '2026-06-18', time: '15:00' }, now, 30)
    expect(slots[0]).toBe('00:00')
    expect(slots).toHaveLength(48)
  })

  it('offers only slots strictly after pickup when return is the same day', () => {
    const slots = returnSlotsForDate('2026-06-19', { date: '2026-06-19', time: '15:00' }, now, 30)
    expect(slots).not.toContain('15:00')
    expect(slots[0]).toBe('15:30')
  })

  it('also honors the now-gate on a same-day return today', () => {
    // today (JST 10:15): slots start 10:30, then filtered to those after 12:00.
    const slots = returnSlotsForDate('2026-06-17', { date: '2026-06-17', time: '12:00' }, now, 30)
    expect(slots).not.toContain('12:00')
    expect(slots[0]).toBe('12:30')
  })
})

describe('ensureEndAfterStart', () => {
  const now = new Date('2026-06-17T01:15:00Z') // JST 10:15

  it('leaves a valid cross-day return untouched', () => {
    const from = { date: '2026-06-18', time: '10:00' }
    const to = { date: '2026-06-20', time: '09:00' }
    expect(ensureEndAfterStart(from, to, now, 30)).toEqual(to)
  })

  it('bumps a single-day selection (to === from) to the next same-day slot', () => {
    const from = { date: '2026-06-19', time: '10:00' }
    expect(ensureEndAfterStart(from, { ...from }, now, 30)).toEqual({
      date: '2026-06-19',
      time: '10:30',
    })
  })

  it('bumps an inverted same-day return to the first slot after pickup', () => {
    const from = { date: '2026-06-19', time: '15:00' }
    const to = { date: '2026-06-19', time: '09:00' }
    expect(ensureEndAfterStart(from, to, now, 30)).toEqual({ date: '2026-06-19', time: '15:30' })
  })

  it('rolls to the next day when pickup is the last slot of its day', () => {
    const from = { date: '2026-06-19', time: '23:30' }
    expect(ensureEndAfterStart(from, { ...from }, now, 30)).toEqual({
      date: '2026-06-20',
      time: '00:00',
    })
  })
})
