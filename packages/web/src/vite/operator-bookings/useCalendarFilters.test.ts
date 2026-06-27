import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BlockCalendarEvent, BookingCalendarEvent } from './calendar-events'
import { useCalendarFilters } from './useCalendarFilters'

// #1101 Slice B B3: the vehicle/status filter is shared by bookings AND blocks, but
// a status toggle must NEVER touch a block (blocks have no status — they are filtered
// by vehicle only). Pin that asymmetry so a future refactor can't silently hide a
// maintenance band behind a status checkbox.

afterEach(() => window.localStorage.clear())

const booking = (
  id: string,
  resourceId: string,
  status: 'CONFIRMED' | 'COMPLETED',
): BookingCalendarEvent => ({
  type: 'booking',
  id,
  title: id,
  start: new Date('2026-07-01T09:00:00.000Z'),
  end: new Date('2026-07-02T09:00:00.000Z'),
  resourceId,
  status,
})

const block = (id: string, resourceId: string): BlockCalendarEvent => ({
  type: 'block',
  id,
  title: 'maint',
  start: new Date('2026-07-01T09:00:00.000Z'),
  end: new Date('2026-07-02T09:00:00.000Z'),
  resourceId,
  kind: 'MAINTENANCE',
  reason: 'maint',
  notes: null,
})

const items = [
  booking('bk-veh1', 'veh-1', 'CONFIRMED'),
  block('blk-veh1', 'veh-1'),
  booking('bk-veh2', 'veh-2', 'COMPLETED'),
]

describe('useCalendarFilters.filterEvents — mixed booking + block items', () => {
  it('passes every item through when nothing is unchecked', () => {
    const { result } = renderHook(() => useCalendarFilters(['veh-1', 'veh-2']))
    expect(result.current.filterEvents(items).map((i) => i.id)).toEqual([
      'bk-veh1',
      'blk-veh1',
      'bk-veh2',
    ])
  })

  it('unchecking a status hides only the matching booking — never a block', () => {
    const { result } = renderHook(() => useCalendarFilters(['veh-1', 'veh-2']))
    act(() => result.current.toggleStatus('CONFIRMED'))
    // The CONFIRMED booking on veh-1 is gone; the veh-1 block stays (no status).
    expect(result.current.filterEvents(items).map((i) => i.id)).toEqual(['blk-veh1', 'bk-veh2'])
  })

  it('unchecking a vehicle hides both its booking and its block', () => {
    const { result } = renderHook(() => useCalendarFilters(['veh-1', 'veh-2']))
    act(() => result.current.toggleVehicle('veh-1'))
    expect(result.current.filterEvents(items).map((i) => i.id)).toEqual(['bk-veh2'])
  })
})
