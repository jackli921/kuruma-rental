import { describe, expect, it } from 'vitest'
import {
  type BlockCalendarEvent,
  type BookingCalendarEvent,
  blocksToCalendarEvents,
  toCalendarEvents,
} from './calendar-events'
import type { CalendarBlockRow } from './schema'

// #1101 Slice B B2: the discriminated CalendarItem union. Bookings carry `status`
// (+ type:'booking'); blocks carry `kind` (+ type:'block'), never a status. These
// pure transforms decide the data shape the rbc shell renders (FC/IS).

describe('toCalendarEvents — tags bookings with the discriminant', () => {
  it("stamps every booking event with type:'booking' and keeps its status", () => {
    const events = toCalendarEvents([
      {
        id: 'bk1',
        bookingCode: 'KRM-1',
        status: 'CONFIRMED',
        startAt: '2026-07-01T09:00:00.000Z',
        effectiveEndAt: '2026-07-03T09:00:00.000Z',
        vehicleId: 'veh-1',
        renterName: 'Aoi',
        renterEmail: null,
        totalPrice: 20000,
      },
    ])
    const [event] = events as BookingCalendarEvent[]
    expect(event?.type).toBe('booking')
    expect(event?.status).toBe('CONFIRMED')
    expect(event?.resourceId).toBe('veh-1')
  })
})

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
