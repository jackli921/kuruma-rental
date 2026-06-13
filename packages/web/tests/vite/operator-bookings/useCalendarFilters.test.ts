import { useCalendarFilters } from '@/vite/operator-bookings/useCalendarFilters'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const VEHICLES = ['v1', 'v2', 'v3']
const STORAGE_KEY = 'kuruma.calendar.filters'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useCalendarFilters', () => {
  it('defaults to all vehicles + all statuses checked', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    expect(result.current.isVehicleChecked('v1')).toBe(true)
    expect(result.current.isVehicleChecked('v2')).toBe(true)
    expect(result.current.isStatusChecked('CONFIRMED')).toBe(true)
    expect(result.current.isStatusChecked('CANCELLED')).toBe(true)
  })

  it('toggleVehicle flips a single vehicle without affecting others', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleVehicle('v1'))
    expect(result.current.isVehicleChecked('v1')).toBe(false)
    expect(result.current.isVehicleChecked('v2')).toBe(true)
  })

  it('toggleStatus flips a single status', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleStatus('CANCELLED'))
    expect(result.current.isStatusChecked('CANCELLED')).toBe(false)
    expect(result.current.isStatusChecked('CONFIRMED')).toBe(true)
  })

  it('selectAllVehicles re-checks every vehicle', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleVehicle('v1'))
    act(() => result.current.toggleVehicle('v2'))
    act(() => result.current.selectAllVehicles())
    expect(result.current.isVehicleChecked('v1')).toBe(true)
    expect(result.current.isVehicleChecked('v2')).toBe(true)
    expect(result.current.isVehicleChecked('v3')).toBe(true)
  })

  it('clearAllVehicles unchecks every vehicle', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.clearAllVehicles())
    expect(result.current.isVehicleChecked('v1')).toBe(false)
    expect(result.current.isVehicleChecked('v2')).toBe(false)
  })

  it('persists state to localStorage and hydrates from it', () => {
    const { result, unmount } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleVehicle('v1'))
    act(() => result.current.toggleStatus('CANCELLED'))
    unmount()

    const second = renderHook(() => useCalendarFilters(VEHICLES))
    expect(second.result.current.isVehicleChecked('v1')).toBe(false)
    expect(second.result.current.isVehicleChecked('v2')).toBe(true)
    expect(second.result.current.isStatusChecked('CANCELLED')).toBe(false)
  })

  it('prunes stale vehicle ids from localStorage (vehicle deleted since last session)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ uncheckedVehicles: ['v1', 'v99'], uncheckedStatuses: [] }),
    )

    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    expect(result.current.isVehicleChecked('v1')).toBe(false)
    expect(result.current.isVehicleChecked('v2')).toBe(true)

    act(() => result.current.toggleVehicle('v2'))
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(parsed.uncheckedVehicles).not.toContain('v99')
  })

  it('re-prunes stale ids when knownVehicleIds arrives after initial mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ uncheckedVehicles: ['v1', 'v99'], uncheckedStatuses: [] }),
    )

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCalendarFilters(ids),
      { initialProps: { ids: [] as string[] } },
    )

    rerender({ ids: VEHICLES })
    expect(result.current.isVehicleChecked('v1')).toBe(false)
    expect(result.current.isVehicleChecked('v2')).toBe(true)
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(parsed.uncheckedVehicles).not.toContain('v99')
    expect(parsed.uncheckedVehicles).toContain('v1')
  })

  it('filters events by vehicle column + status, and resources by vehicle', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleVehicle('v1'))
    act(() => result.current.toggleStatus('CANCELLED'))

    const events = [
      { id: 'e1', resourceId: 'v1', status: 'CONFIRMED' as const },
      { id: 'e2', resourceId: 'v2', status: 'CONFIRMED' as const },
      { id: 'e3', resourceId: 'v2', status: 'CANCELLED' as const },
    ]
    expect(result.current.filterEvents(events).map((e) => e.id)).toEqual(['e2'])

    const resources = [
      { resourceId: 'v1', resourceTitle: 'Car A' },
      { resourceId: 'v2', resourceTitle: 'Car B' },
    ]
    expect(result.current.filterResources(resources).map((r) => r.resourceId)).toEqual(['v2'])
  })
})
