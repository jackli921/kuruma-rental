import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED_GROUP_ID,
  bookingIdFromTimelineItem,
  buildTimelineLayout,
} from './timeline-layout'

// Window: 2027-01-10 .. 2027-01-24 (14 days) in epoch ms.
const FROM = Date.UTC(2027, 0, 10)
const TO = Date.UTC(2027, 0, 24)
const iso = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).toISOString()

function row(over: Partial<CalendarBookingRow> = {}): CalendarBookingRow {
  return {
    id: 'bk1',
    bookingCode: 'KUR-1',
    status: 'CONFIRMED',
    startAt: iso(2027, 1, 12),
    endAt: iso(2027, 1, 14),
    effectiveEndAt: iso(2027, 1, 14), // no turnaround by default
    vehicleId: 'v1',
    renterName: 'Aiko',
    renterEmail: 'aiko@example.com',
    totalPrice: 50000,
    ...over,
  }
}

const FLEET = [
  { id: 'v1', name: 'Prius' },
  { id: 'v2', name: 'Note' },
]

function block(over: Partial<BlockCalendarEvent> = {}): BlockCalendarEvent {
  return {
    type: 'block',
    id: 'blk1',
    title: 'Oil change',
    start: new Date(Date.UTC(2027, 0, 12)),
    end: new Date(Date.UTC(2027, 0, 14)),
    resourceId: 'v1',
    kind: 'MAINTENANCE',
    reason: 'Oil change',
    notes: null,
    ...over,
  }
}

function build(rows: CalendarBookingRow[], vehicles = FLEET, blocks: BlockCalendarEvent[] = []) {
  return buildTimelineLayout({
    rows,
    vehicles,
    blocks,
    from: FROM,
    to: TO,
    unassignedLabel: 'Unassigned',
  })
}

describe('buildTimelineLayout', () => {
  it('emits one group per fleet vehicle in order, no Unassigned row when no floats', () => {
    const { groups } = build([row()])
    expect(groups).toEqual([
      { id: 'v1', title: 'Prius' },
      { id: 'v2', title: 'Note' },
    ])
  })

  it('shows every vehicle as a row even with zero bookings', () => {
    const { groups } = build([])
    expect(groups.map((g) => g.id)).toEqual(['v1', 'v2'])
  })

  it('appends an Unassigned group (only) when a class-only float exists', () => {
    const { groups } = build([row({ id: 'float', vehicleId: null })])
    expect(groups.at(-1)).toEqual({ id: UNASSIGNED_GROUP_ID, title: 'Unassigned' })
    expect(groups).toHaveLength(3)
  })

  it('renders a booked-only booking as one solid band with exact clamped times', () => {
    const { items } = build([row()])
    expect(items).toEqual([
      {
        type: 'booking',
        id: 'bk1',
        bookingId: 'bk1',
        group: 'v1',
        title: 'Aiko',
        start: Date.UTC(2027, 0, 12),
        end: Date.UTC(2027, 0, 14),
        band: 'booked',
        status: 'CONFIRMED',
      },
    ])
  })

  it('splits a turnaround tail into a second lighter band', () => {
    const { items } = build([row({ effectiveEndAt: iso(2027, 1, 16) })])
    expect(items).toHaveLength(2)
    const tail = items.find((i) => i.type === 'booking' && i.band === 'turnaround')
    expect(tail).toMatchObject({
      id: 'bk1::turnaround',
      bookingId: 'bk1',
      group: 'v1',
      start: Date.UTC(2027, 0, 14),
      end: Date.UTC(2027, 0, 16),
    })
  })

  it('clamps a booking starting before the window to the window start', () => {
    const { items } = build([row({ startAt: iso(2027, 1, 5) })])
    expect(items[0]?.start).toBe(FROM)
    expect(items[0]?.end).toBe(Date.UTC(2027, 0, 14))
  })

  it('clamps a turnaround running past the window to the window end', () => {
    const { items } = build([row({ endAt: iso(2027, 1, 22), effectiveEndAt: iso(2027, 1, 30) })])
    const tail = items.find((i) => i.type === 'booking' && i.band === 'turnaround')
    expect(tail?.end).toBe(TO)
  })

  it('drops a turnaround band that falls entirely after the window', () => {
    const { items } = build([row({ endAt: iso(2027, 1, 24), effectiveEndAt: iso(2027, 1, 26) })])
    expect(items.every((i) => i.type === 'booking' && i.band === 'booked')).toBe(true)
  })

  it('drops a booked band entirely before the window but keeps an in-window tail', () => {
    const { items } = build([
      row({ startAt: iso(2027, 1, 4), endAt: iso(2027, 1, 8), effectiveEndAt: iso(2027, 1, 12) }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ band: 'turnaround', start: FROM, end: Date.UTC(2027, 0, 12) })
  })

  it('routes a booking on an unknown vehicle to Unassigned instead of dropping it', () => {
    const { groups, items } = build([row({ vehicleId: 'ghost' })])
    expect(groups.at(-1)?.id).toBe(UNASSIGNED_GROUP_ID)
    expect(items[0]?.group).toBe(UNASSIGNED_GROUP_ID)
  })

  it('titles a band by renter name, then email, then booking code', () => {
    const { items } = build([row({ renterName: null, renterEmail: 'x@y.z' })])
    expect(items[0]?.title).toBe('x@y.z')
    const { items: i2 } = build([row({ renterName: null, renterEmail: null })])
    expect(i2[0]?.title).toBe('KUR-1')
  })
})

describe('buildTimelineLayout blocks', () => {
  it('renders a block as a kind-tagged band on its vehicle row', () => {
    const { items } = build([], FLEET, [block()])
    expect(items).toEqual([
      {
        type: 'block',
        id: 'blk1',
        blockId: 'blk1',
        group: 'v1',
        title: 'Oil change',
        start: Date.UTC(2027, 0, 12),
        end: Date.UTC(2027, 0, 14),
        kind: 'MAINTENANCE',
      },
    ])
  })

  it('carries the block discriminant with a kind and no booking status', () => {
    const { items } = build([], FLEET, [block({ kind: 'OUT_OF_SERVICE' })])
    const it0 = items[0]
    expect(it0).toMatchObject({ type: 'block', kind: 'OUT_OF_SERVICE' })
    expect(it0 && 'status' in it0).toBe(false)
    expect(it0 && 'bookingId' in it0).toBe(false)
  })

  it('clamps a block spanning past both window edges to the window', () => {
    const { items } = build([], FLEET, [
      block({ start: new Date(Date.UTC(2027, 0, 5)), end: new Date(Date.UTC(2027, 0, 30)) }),
    ])
    expect(items[0]).toMatchObject({ type: 'block', start: FROM, end: TO })
  })

  it('drops a block that falls entirely outside the window', () => {
    const { items } = build([], FLEET, [
      block({ start: new Date(Date.UTC(2027, 0, 1)), end: new Date(Date.UTC(2027, 0, 3)) }),
    ])
    expect(items).toHaveLength(0)
  })

  it('skips a block on a non-fleet vehicle and never opens an Unassigned row for it', () => {
    const { groups, items } = build([], FLEET, [block({ resourceId: 'ghost' })])
    expect(items).toHaveLength(0)
    expect(groups.some((g) => g.id === UNASSIGNED_GROUP_ID)).toBe(false)
  })

  it('lays booking and block bands together, bookings first', () => {
    const { items } = build([row()], FLEET, [
      block({
        id: 'blk9',
        start: new Date(Date.UTC(2027, 0, 16)),
        end: new Date(Date.UTC(2027, 0, 18)),
      }),
    ])
    expect(items.map((i) => i.type)).toEqual(['booking', 'block'])
  })
})

describe('bookingIdFromTimelineItem', () => {
  it('returns the id unchanged for a booked-band bar', () => {
    expect(bookingIdFromTimelineItem('booking-123')).toBe('booking-123')
  })

  it('strips the ::turnaround suffix so the tail opens the same booking', () => {
    expect(bookingIdFromTimelineItem('booking-123::turnaround')).toBe('booking-123')
  })

  it('does not strip an interior ::turnaround that is not the suffix', () => {
    expect(bookingIdFromTimelineItem('a::turnaround::b')).toBe('a::turnaround::b')
  })

  it('round-trips the build-time encode: the tail item id decodes to its bookingId', () => {
    // Pin the encode/decode contract end-to-end so the shared suffix can't drift:
    // a booking with a turnaround tail emits a `::turnaround` item whose id decodes
    // back to the original booking id.
    const { items } = build([
      row({ id: 'bk9', endAt: iso(2027, 1, 14), effectiveEndAt: iso(2027, 1, 15) }),
    ])
    const tail = items.find((i) => i.type === 'booking' && i.band === 'turnaround')
    expect(tail).toBeDefined()
    expect(tail?.id).not.toBe('bk9') // it carries the suffix
    expect(bookingIdFromTimelineItem(tail!.id)).toBe('bk9')
  })
})
