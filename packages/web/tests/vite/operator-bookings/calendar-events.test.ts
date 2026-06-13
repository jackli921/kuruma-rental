import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import {
  type CalendarView,
  calendarRange,
  fleetToResources,
  formatCalendarDate,
  parseCalendarDate,
  parseCalendarView,
  toCalendarEvents,
} from '@/vite/operator-bookings/calendar-events'
import { describe, expect, it } from 'vitest'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const row = (over: Partial<CalendarBookingRow> = {}): CalendarBookingRow => ({
  id: 'bk-1',
  bookingCode: 'ABCD2345',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  effectiveEndAt: '2026-07-03T02:00:00.000Z',
  vehicleId: 'veh-1',
  renterName: 'Jane',
  renterEmail: 'jane@example.com',
  totalPrice: 24000,
  ...over,
})

describe('toCalendarEvents', () => {
  it('maps a row to an rbc event bound to its vehicle column, ending at the turnaround end', () => {
    expect(toCalendarEvents([row()])).toEqual([
      {
        id: 'bk-1',
        title: 'Jane',
        start: new Date('2026-07-01T01:00:00.000Z'),
        end: new Date('2026-07-03T02:00:00.000Z'),
        resourceId: 'veh-1',
        status: 'CONFIRMED',
      },
    ])
  })

  it('titles by renterEmail when the name is null, then by bookingCode when both are null', () => {
    expect(toCalendarEvents([row({ renterName: null })])[0]!.title).toBe('jane@example.com')
    expect(toCalendarEvents([row({ renterName: null, renterEmail: null })])[0]!.title).toBe(
      'ABCD2345',
    )
  })

  it('binds an unassigned (class-only) booking to no column via an empty resourceId', () => {
    expect(toCalendarEvents([row({ vehicleId: null })])[0]!.resourceId).toBe('')
  })
})

describe('fleetToResources', () => {
  it('maps fleet vehicles to id/name resource columns, preserving order', () => {
    expect(
      fleetToResources([
        { id: 'v1', name: 'Toyota Aqua' },
        { id: 'v2', name: 'Nissan Note' },
      ]),
    ).toEqual([
      { resourceId: 'v1', resourceTitle: 'Toyota Aqua' },
      { resourceId: 'v2', resourceTitle: 'Nissan Note' },
    ])
  })

  it('returns an empty list for an empty fleet', () => {
    expect(fleetToResources([])).toEqual([])
  })
})

describe('calendarRange', () => {
  // 2026-07-15 is a Wednesday; noon avoids any midnight/DST boundary flake.
  const anchor = new Date('2026-07-15T12:00:00.000Z')

  const span = (view: CalendarView) => {
    const { from, to } = calendarRange(view, anchor)
    return { from: new Date(from), to: new Date(to) }
  }

  it('spans the anchor day in day view (~24h, containing the anchor)', () => {
    const { from, to } = span('day')
    expect(from.getTime()).toBeLessThanOrEqual(anchor.getTime())
    expect(to.getTime()).toBeGreaterThan(anchor.getTime())
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(23 * HOUR_MS)
    expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(25 * HOUR_MS)
  })

  it('spans a Monday-start week in week view (~7 days)', () => {
    const { from, to } = span('week')
    expect(from.getDay()).toBe(1) // Monday
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(6 * DAY_MS)
    expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(8 * DAY_MS)
  })

  it('covers the whole month grid in month view (Monday-aligned, enclosing the month)', () => {
    const { from, to } = span('month')
    expect(from.getDay()).toBe(1) // grid starts on a Monday
    expect(from.getTime()).toBeLessThanOrEqual(new Date('2026-07-01T00:00:00').getTime())
    expect(to.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-31T23:59:59').getTime())
  })
})

describe('parseCalendarView', () => {
  it('keeps a valid view and defaults anything else to week', () => {
    expect(parseCalendarView('day')).toBe('day')
    expect(parseCalendarView('month')).toBe('month')
    expect(parseCalendarView('agenda')).toBe('week') // a real rbc view we do not offer
    expect(parseCalendarView(undefined)).toBe('week')
  })
})

describe('formatCalendarDate / parseCalendarDate', () => {
  it('round-trips a local calendar day regardless of time of day', () => {
    const s = formatCalendarDate(new Date(2026, 6, 15, 9, 30)) // local Jul 15 2026
    expect(s).toBe('2026-07-15')
    const back = parseCalendarDate(s)
    expect([back.getFullYear(), back.getMonth(), back.getDate()]).toEqual([2026, 6, 15])
  })

  it('falls back to today for a missing, malformed, or overflowed date', () => {
    const today = new Date()
    const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()]
    for (const bad of [undefined, '', 'not-a-date', '2026-13-99', '2026-7-1']) {
      expect(ymd(parseCalendarDate(bad))).toEqual(ymd(today))
    }
  })
})
