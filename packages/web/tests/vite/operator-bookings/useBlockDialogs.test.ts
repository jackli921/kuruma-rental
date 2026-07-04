import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { useBlockDialogs } from '@/vite/operator-bookings/useBlockDialogs'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const RANGE = { start: new Date('2026-08-01T09:00:00Z'), end: new Date('2026-08-01T17:00:00Z') }
const BLOCK: BlockCalendarEvent = {
  type: 'block',
  id: 'blk-1',
  title: 'Oil change',
  start: new Date('2026-07-01T00:00:00.000Z'),
  end: new Date('2026-07-02T00:00:00.000Z'),
  resourceId: 'veh-2',
  kind: 'MAINTENANCE',
  reason: 'Oil change',
  notes: null,
}

describe('useBlockDialogs', () => {
  it('defaults to both dialogs closed with no prefill', () => {
    const { result } = renderHook(() => useBlockDialogs())
    expect(result.current.scheduleOpen).toBe(false)
    expect(result.current.slotRange).toBeNull()
    expect(result.current.slotVehicleId).toBeUndefined()
    expect(result.current.selectedBlock).toBeNull()
  })

  it('openSchedule() opens the schedule dialog with no prefill (header button)', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openSchedule())
    expect(result.current.scheduleOpen).toBe(true)
    expect(result.current.slotRange).toBeNull()
    expect(result.current.slotVehicleId).toBeUndefined()
  })

  it('openScheduleForSlot(range, vehicleId) opens with the clicked range + vehicle', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openScheduleForSlot(RANGE, 'veh-9'))
    expect(result.current.scheduleOpen).toBe(true)
    expect(result.current.slotRange).toEqual(RANGE)
    expect(result.current.slotVehicleId).toBe('veh-9')
  })

  it('openScheduleForSlot(range) with no vehicle leaves the vehicle unset', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openScheduleForSlot(RANGE))
    expect(result.current.scheduleOpen).toBe(true)
    expect(result.current.slotRange).toEqual(RANGE)
    expect(result.current.slotVehicleId).toBeUndefined()
  })

  it('openSchedule() after a slot prefill resets the range + vehicle', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openScheduleForSlot(RANGE, 'veh-9'))
    act(() => result.current.openSchedule())
    expect(result.current.slotRange).toBeNull()
    expect(result.current.slotVehicleId).toBeUndefined()
  })

  it('setScheduleOpen(false) closes the schedule dialog', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openSchedule())
    act(() => result.current.setScheduleOpen(false))
    expect(result.current.scheduleOpen).toBe(false)
  })

  it('selectBlock() sets the detail target; closeDetail() clears it', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.selectBlock(BLOCK))
    expect(result.current.selectedBlock).toEqual(BLOCK)
    act(() => result.current.closeDetail())
    expect(result.current.selectedBlock).toBeNull()
  })

  it('the detail dialog is independent of the schedule dialog', () => {
    const { result } = renderHook(() => useBlockDialogs())
    act(() => result.current.openScheduleForSlot(RANGE, 'veh-9'))
    act(() => result.current.selectBlock(BLOCK))
    expect(result.current.selectedBlock).toEqual(BLOCK)
    expect(result.current.scheduleOpen).toBe(true)
    expect(result.current.slotVehicleId).toBe('veh-9')
  })
})
