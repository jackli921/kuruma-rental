import { todayInJst } from '@/lib/datetime'
import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import {
  type BlockCalendarEvent,
  type CalendarItem,
  blocksToCalendarEvents,
  calendarItemClassName,
  calendarRange,
  defaultCalendarView,
  fleetToResources,
  formatCalendarDate,
  normalizeViewParam,
  operatorViews,
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

describe('calendarRange (JST-anchored, #1250)', () => {
  // 2026-07-15 is a Wednesday. Built from LOCAL fields so the anchor's calendar day is
  // July 15 in ANY runner TZ. The bounds are anchored to the JST day/week/month, not
  // the browser-local one, so an off-JST viewer's fetch window is the SAME instants a
  // Tokyo viewer gets — no booking near JST-midnight drops out of the query. Asserted
  // as exact UTC ISO (a JST wall clock is `wall - 9h`), so these hold under any TZ.
  const anchor = new Date(2026, 6, 15, 12)

  it('spans the JST day in day view (00:00–23:59:59.999 JST)', () => {
    expect(calendarRange('day', anchor)).toEqual({
      from: '2026-07-14T15:00:00.000Z', // JST 2026-07-15 00:00
      to: '2026-07-15T14:59:59.999Z', // JST 2026-07-15 23:59:59.999
    })
  })

  it('spans a fixed 14-day JST planning window from the anchor day in timeline view', () => {
    const { from, to } = calendarRange('timeline', anchor)
    expect(from).toBe('2026-07-14T15:00:00.000Z') // JST 2026-07-15 00:00
    expect(to).toBe('2026-07-28T15:00:00.000Z') // JST 2026-07-29 00:00 — exactly 14 days
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(14 * DAY_MS)
  })

  it('spans the Monday-start JST week in week view', () => {
    expect(calendarRange('week', anchor)).toEqual({
      from: '2026-07-12T15:00:00.000Z', // JST Mon 2026-07-13 00:00
      to: '2026-07-19T14:59:59.999Z', // JST Sun 2026-07-19 23:59:59.999
    })
  })

  it('covers the whole month grid in month view (Monday-aligned JST weeks enclosing July)', () => {
    expect(calendarRange('month', anchor)).toEqual({
      from: '2026-06-28T15:00:00.000Z', // JST Mon 2026-06-29 00:00 (grid start)
      to: '2026-08-02T14:59:59.999Z', // JST Sun 2026-08-02 23:59:59.999 (grid end)
    })
  })
})

describe('parseCalendarView (fleet timeline enabled)', () => {
  // The timeline board (#1100) is the operator default only while its flag is on; the
  // caller passes the effective value (#1322), so this is pure of the runtime env.
  it('keeps a valid view and defaults anything else to the timeline board', () => {
    expect(parseCalendarView('timeline', true)).toBe('timeline')
    expect(parseCalendarView('day', true)).toBe('day')
    expect(parseCalendarView('week', true)).toBe('week')
    expect(parseCalendarView('month', true)).toBe('month')
    expect(parseCalendarView('agenda', true)).toBe('timeline') // a real rbc view we do not offer
    expect(parseCalendarView(undefined, true)).toBe('timeline')
  })
})

describe('fleet-timeline view gating (#1100)', () => {
  it('enabled → timeline leads the switcher and is the landing default', () => {
    expect(operatorViews(true)).toEqual(['timeline', 'day', 'week', 'month'])
    expect(defaultCalendarView(true)).toBe('timeline')
  })

  it('gated off → the timeline view drops out and week becomes the default', () => {
    expect(operatorViews(false)).toEqual(['day', 'week', 'month'])
    expect(defaultCalendarView(false)).toBe('week')
  })

  it('gated off → a hand-typed ?view=timeline falls back to the week grid', () => {
    expect(parseCalendarView('timeline', false)).toBe('week')
    expect(parseCalendarView(undefined, false)).toBe('week')
    // The remaining grids still parse through untouched.
    expect(parseCalendarView('day', false)).toBe('day')
    expect(parseCalendarView('month', false)).toBe('month')
  })
})

describe('normalizeViewParam (flag-blind URL narrowing for validateSearch)', () => {
  it('keeps any KNOWN view string, including timeline (the flag decides later)', () => {
    expect(normalizeViewParam('timeline')).toBe('timeline')
    expect(normalizeViewParam('day')).toBe('day')
    expect(normalizeViewParam('week')).toBe('week')
    expect(normalizeViewParam('month')).toBe('month')
  })

  it('drops an unknown or non-string value to undefined', () => {
    expect(normalizeViewParam('agenda')).toBeUndefined()
    expect(normalizeViewParam(undefined)).toBeUndefined()
    expect(normalizeViewParam(42)).toBeUndefined()
  })
})

describe('formatCalendarDate / parseCalendarDate', () => {
  it('round-trips a local calendar day regardless of time of day', () => {
    const s = formatCalendarDate(new Date(2026, 6, 15, 9, 30)) // local Jul 15 2026
    expect(s).toBe('2026-07-15')
    const back = parseCalendarDate(s)
    expect([back.getFullYear(), back.getMonth(), back.getDate()]).toEqual([2026, 6, 15])
  })

  it('falls back to the JST calendar day (not the browser-local day) when missing/malformed', () => {
    // #1250: near midnight an off-JST browser's local day can differ from the Tokyo
    // day the operator works in; the fallback must anchor to JST so TODAY lands right.
    const jstToday = todayInJst()
    const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()]
    for (const bad of [undefined, '', 'not-a-date', '2026-13-99', '2026-7-1']) {
      expect(ymd(parseCalendarDate(bad))).toEqual(ymd(jstToday))
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
