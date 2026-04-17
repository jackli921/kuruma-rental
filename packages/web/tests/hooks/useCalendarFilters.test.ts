import { useCalendarFilters } from '@/hooks/useCalendarFilters'
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
    // Simulate storage from an earlier session that had v1, v2, v3, v4
    // with v1 unchecked.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        uncheckedVehicles: ['v1', 'v99'], // v99 is stale
        uncheckedStatuses: [],
      }),
    )

    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    // v1 still unchecked, v99 pruned (not crashing + not leaking state)
    expect(result.current.isVehicleChecked('v1')).toBe(false)
    expect(result.current.isVehicleChecked('v2')).toBe(true)

    // After any interaction, the stale id should be pruned from storage
    act(() => result.current.toggleVehicle('v2'))
    const raw = localStorage.getItem(STORAGE_KEY)!
    const parsed = JSON.parse(raw)
    expect(parsed.uncheckedVehicles).not.toContain('v99')
  })

  it('re-prunes stale ids when knownVehicleIds arrives after initial mount', () => {
    // Fleet query is still loading on first render — ids arrive later.
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

  it('filters a list of events + resources through filterEvents/filterResources', () => {
    const { result } = renderHook(() => useCalendarFilters(VEHICLES))
    act(() => result.current.toggleVehicle('v1'))
    act(() => result.current.toggleStatus('CANCELLED'))

    const events = [
      { id: 'e1', raw: { vehicleId: 'v1', status: 'CONFIRMED' as const } },
      { id: 'e2', raw: { vehicleId: 'v2', status: 'CONFIRMED' as const } },
      { id: 'e3', raw: { vehicleId: 'v2', status: 'CANCELLED' as const } },
    ]
    const visible = result.current.filterEvents(events)
    expect(visible.map((e) => e.id)).toEqual(['e2'])

    const resources = [
      { resourceId: 'v1', resourceTitle: 'Car A' },
      { resourceId: 'v2', resourceTitle: 'Car B' },
    ]
    const visibleResources = result.current.filterResources(resources)
    expect(visibleResources.map((r) => r.resourceId)).toEqual(['v2'])
  })
})
