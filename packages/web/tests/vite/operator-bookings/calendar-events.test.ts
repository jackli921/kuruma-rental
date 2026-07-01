import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import {
  type BlockCalendarEvent,
  type CalendarItem,
  type CalendarView,
  blocksToCalendarEvents,
  calendarItemClassName,
  calendarRange,
  fleetToResources,
  formatCalendarDate,
  parseCalendarDate,
  parseCalendarView,
  toCalendarEvents,
} from '@/vite/operator-bookings/calendar-events'
import type { CalendarBlockRow } from '@/vite/operator-bookings/schema'
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

const fleet = [
  { id: 'veh-1', name: 'Toyota Aqua' },
  { id: 'veh-2', name: 'Nissan Note' },
]

describe('toCalendarEvents', () => {
  it('maps a row to an rbc event with the in-hand quick-view fields', () => {
    expect(toCalendarEvents([row()], fleet)).toEqual([
      {
        // #1101: every booking event carries the discriminant so a block can never
        // be mistaken for one (and vice versa) at any consuming switch.
        type: 'booking',
        id: 'bk-1',
        title: 'Jane',
        start: new Date('2026-07-01T01:00:00.000Z'),
        end: new Date('2026-07-03T02:00:00.000Z'),
        resourceId: 'veh-1',
        status: 'CONFIRMED',
        bookingCode: 'ABCD2345',
        renterName: 'Jane',
        renterEmail: 'jane@example.com',
        vehicleName: 'Toyota Aqua',
        totalPrice: 24000,
      },
    ])
  })

  it('titles by renterEmail when the name is null, then by bookingCode when both are null', () => {
    expect(toCalendarEvents([row({ renterName: null })], fleet)[0]!.title).toBe('jane@example.com')
    expect(toCalendarEvents([row({ renterName: null, renterEmail: null })], fleet)[0]!.title).toBe(
      'ABCD2345',
    )
  })

  it('resolves vehicleName from the fleet map and is null for an unassigned booking', () => {
    expect(toCalendarEvents([row({ vehicleId: 'veh-2' })], fleet)[0]!.vehicleName).toBe(
      'Nissan Note',
    )
    expect(toCalendarEvents([row({ vehicleId: null })], fleet)[0]!.vehicleName).toBeNull()
    expect(toCalendarEvents([row({ vehicleId: null })], fleet)[0]!.resourceId).toBe('')
  })

  it('is null for a vehicleId absent from the fleet map (deleted car)', () => {
    expect(toCalendarEvents([row({ vehicleId: 'gone' })], fleet)[0]!.vehicleName).toBeNull()
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

  it('spans a fixed 14-day planning window from the anchor day in timeline view', () => {
    const { from, to } = span('timeline')
    expect(from.getHours()).toBe(0) // anchored at local midnight of the anchor day
    expect(from.getTime()).toBeLessThanOrEqual(anchor.getTime())
    const days = (to.getTime() - from.getTime()) / DAY_MS
    expect(days).toBeGreaterThanOrEqual(13.9) // ~14 days (DST-tolerant), not 13 or 15
    expect(days).toBeLessThanOrEqual(14.1)
  })

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
  it('keeps a valid view and defaults anything else to the timeline board', () => {
    expect(parseCalendarView('timeline')).toBe('timeline')
    expect(parseCalendarView('day')).toBe('day')
    expect(parseCalendarView('week')).toBe('week')
    expect(parseCalendarView('month')).toBe('month')
    expect(parseCalendarView('agenda')).toBe('timeline') // a real rbc view we do not offer
    expect(parseCalendarView(undefined)).toBe('timeline')
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

// #1101 Slice B B2: the discriminated CalendarItem union. Blocks carry `kind`
// (+ type:'block'), never a status; these pure transforms decide the data shape the
// rbc shell renders (FC/IS).

describe('blocksToCalendarEvents — maps blocks to the block arm', () => {
  const block: CalendarBlockRow = {
    id: 'blk-1',
    vehicleId: 'veh-9',
    startAt: '2026-07-04T00:00:00.000Z',
    endAt: '2026-07-05T00:00:00.000Z',
    kind: 'MAINTENANCE',
    reason: 'Oil change',
    notes: 'lift bay 2',
  }

  it("maps a block to type:'block' keyed on its vehicle, carrying kind/reason/notes + a Date window", () => {
    const [event] = blocksToCalendarEvents([block]) as BlockCalendarEvent[]
    expect(event?.type).toBe('block')
    expect(event?.id).toBe('blk-1')
    // The resource-column key is the vehicle id (same axis as bookings).
    expect(event?.resourceId).toBe('veh-9')
    expect(event?.kind).toBe('MAINTENANCE')
    expect(event?.reason).toBe('Oil change')
    expect(event?.notes).toBe('lift bay 2')
    // Title is the operator's own reason (kind drives the band color + legend).
    expect(event?.title).toBe('Oil change')
    expect(event?.start).toEqual(new Date('2026-07-04T00:00:00.000Z'))
    expect(event?.end).toEqual(new Date('2026-07-05T00:00:00.000Z'))
  })

  it('carries no status field — a block is never a booking', () => {
    const [event] = blocksToCalendarEvents([block])
    expect('status' in (event ?? {})).toBe(false)
  })
})

describe('calendarItemClassName — dispatches band styling on the discriminant', () => {
  const bookingItem: CalendarItem = {
    type: 'booking',
    id: 'bk',
    title: 'bk',
    start: new Date(),
    end: new Date(),
    resourceId: 'veh',
    status: 'CONFIRMED',
  }
  const blockItem: CalendarItem = {
    type: 'block',
    id: 'blk',
    title: 'maint',
    start: new Date(),
    end: new Date(),
    resourceId: 'veh',
    kind: 'OUT_OF_SERVICE',
    reason: 'maint',
    notes: null,
  }

  it('gives a booking its status color class', () => {
    expect(calendarItemClassName(bookingItem)).toBe('rbc-event--confirmed')
  })

  it('gives a block its per-kind band class (distinct from any status class)', () => {
    expect(calendarItemClassName(blockItem)).toBe('rbc-event--block-out-of-service')
  })
})
