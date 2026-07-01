import type { OperatorBookingStatus } from '@/vite/operator-bookings/api'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// #525 Slice C: vehicle + status filters for the operator calendar. Ported from
// the frozen Next hook. Persists to localStorage (filters are a device-level view
// preference, not shareable state — so they live here, not in the URL like
// view/date). The key is per-browser, NOT per-user: on a shared machine the
// filters carry across sessions. That is acceptable because they only hide/show
// rows in the operator's own already-authorized view — no data-access implication;
// namespacing the key by operator id is a follow-up if shared kiosks materialize.
// Tracks *hidden* items, not visible ones, so a newly added vehicle defaults to
// visible (an additive fleet change never retroactively hides a car).

const STORAGE_KEY = 'kuruma.calendar.filters'
const ALL_STATUSES = BOOKING_STATUSES

interface StoredState {
  uncheckedVehicles: string[]
  uncheckedStatuses: OperatorBookingStatus[]
}

function loadFromStorage(): StoredState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredState
    if (!Array.isArray(parsed.uncheckedVehicles)) return null
    if (!Array.isArray(parsed.uncheckedStatuses)) return null
    return parsed
  } catch {
    return null
  }
}

function saveToStorage(state: StoredState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota / privacy-mode errors — filters aren't critical.
  }
}

export interface CalendarFiltersApi {
  isVehicleChecked: (id: string) => boolean
  isStatusChecked: (status: OperatorBookingStatus) => boolean
  toggleVehicle: (id: string) => void
  toggleStatus: (status: OperatorBookingStatus) => void
  selectAllVehicles: () => void
  clearAllVehicles: () => void
  // #1101: items are the booking|block union. Both are filtered by vehicle
  // (resourceId); the STATUS filter applies to bookings only — a block carries no
  // status, so a status toggle never hides it. Generic so a caller passing a
  // narrower array (bookings only) gets that narrower element type back.
  filterEvents: <T extends { resourceId: string }>(events: readonly T[]) => T[]
  filterResources: <T extends { resourceId: string }>(resources: readonly T[]) => T[]
}

export function useCalendarFilters(knownVehicleIds: readonly string[]): CalendarFiltersApi {
  // Load raw state; pruning happens in the effect below so it still runs when
  // fleet data arrives on a later render (first render might have ids=[]).
  const [uncheckedVehicles, setUncheckedVehicles] = useState<Set<string>>(() => {
    const stored = loadFromStorage()
    return stored ? new Set(stored.uncheckedVehicles) : new Set()
  })

  const [uncheckedStatuses, setUncheckedStatuses] = useState<Set<OperatorBookingStatus>>(() => {
    const stored = loadFromStorage()
    if (!stored) return new Set()
    return new Set(stored.uncheckedStatuses.filter((s) => ALL_STATUSES.includes(s)))
  })

  // Prune stale ids whenever the fleet arrives or changes. The setState
  // short-circuits (returns prev) when nothing changed, so re-running is cheap.
  useEffect(() => {
    if (knownVehicleIds.length === 0) return
    const known = new Set(knownVehicleIds)
    setUncheckedVehicles((prev) => {
      let pruned: Set<string> | null = null
      for (const id of prev) {
        if (!known.has(id)) {
          pruned ??= new Set(prev)
          pruned.delete(id)
        }
      }
      return pruned ?? prev
    })
  }, [knownVehicleIds])

  // Keep a ref to the latest known ids so `clearAllVehicles` stays
  // reference-stable (no dep on `knownVehicleIds`).
  const knownIdsRef = useRef(knownVehicleIds)
  useEffect(() => {
    knownIdsRef.current = knownVehicleIds
  }, [knownVehicleIds])

  useEffect(() => {
    saveToStorage({
      uncheckedVehicles: [...uncheckedVehicles],
      uncheckedStatuses: [...uncheckedStatuses],
    })
  }, [uncheckedVehicles, uncheckedStatuses])

  const isVehicleChecked = useCallback(
    (id: string) => !uncheckedVehicles.has(id),
    [uncheckedVehicles],
  )
  const isStatusChecked = useCallback(
    (status: OperatorBookingStatus) => !uncheckedStatuses.has(status),
    [uncheckedStatuses],
  )

  const toggleVehicle = useCallback((id: string) => {
    setUncheckedVehicles((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleStatus = useCallback((status: OperatorBookingStatus) => {
    setUncheckedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }, [])

  const selectAllVehicles = useCallback(() => setUncheckedVehicles(new Set()), [])
  const clearAllVehicles = useCallback(() => setUncheckedVehicles(new Set(knownIdsRef.current)), [])

  const filterEvents = useCallback(
    <T extends { resourceId: string }>(events: readonly T[]): T[] =>
      events.filter((e) => {
        if (uncheckedVehicles.has(e.resourceId)) return false
        // The generic `<T extends { resourceId }>` erases the CalendarItem
        // discriminant (this filter is shared with filterResources), so we probe
        // `status` structurally rather than switching on `type`. Safe because the
        // union guarantees only bookings carry a status — a block reads `undefined`
        // and bypasses the status filter entirely (`status === undefined` passes).
        const status = (e as { status?: OperatorBookingStatus }).status
        return status === undefined || !uncheckedStatuses.has(status)
      }),
    [uncheckedVehicles, uncheckedStatuses],
  )

  const filterResources = useCallback(
    <T extends { resourceId: string }>(resources: readonly T[]): T[] =>
      resources.filter((r) => !uncheckedVehicles.has(r.resourceId)),
    [uncheckedVehicles],
  )

  // Memoize the returned object so downstream useMemo/useCallback deps don't
  // invalidate on every render.
  return useMemo<CalendarFiltersApi>(
    () => ({
      isVehicleChecked,
      isStatusChecked,
      toggleVehicle,
      toggleStatus,
      selectAllVehicles,
      clearAllVehicles,
      filterEvents,
      filterResources,
    }),
    [
      isVehicleChecked,
      isStatusChecked,
      toggleVehicle,
      toggleStatus,
      selectAllVehicles,
      clearAllVehicles,
      filterEvents,
      filterResources,
    ],
  )
}
