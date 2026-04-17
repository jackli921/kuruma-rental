'use client'

import type { BookingStatus } from '@kuruma/shared/db/schema'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'kuruma.calendar.filters'
const ALL_STATUSES: readonly BookingStatus[] = ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED']

interface StoredState {
  uncheckedVehicles: string[]
  uncheckedStatuses: BookingStatus[]
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
  isStatusChecked: (status: BookingStatus) => boolean
  toggleVehicle: (id: string) => void
  toggleStatus: (status: BookingStatus) => void
  selectAllVehicles: () => void
  clearAllVehicles: () => void
  filterEvents: <T extends { raw: { vehicleId: string; status: BookingStatus } }>(
    events: T[],
  ) => T[]
  filterResources: <T extends { resourceId: string }>(resources: T[]) => T[]
}

export function useCalendarFilters(knownVehicleIds: string[]): CalendarFiltersApi {
  const [uncheckedVehicles, setUncheckedVehicles] = useState<Set<string>>(() => {
    const stored = loadFromStorage()
    if (!stored) return new Set()
    // Prune stale ids — keep only those that still exist.
    const known = new Set(knownVehicleIds)
    return new Set(stored.uncheckedVehicles.filter((id) => known.has(id)))
  })

  const [uncheckedStatuses, setUncheckedStatuses] = useState<Set<BookingStatus>>(() => {
    const stored = loadFromStorage()
    if (!stored) return new Set()
    return new Set(stored.uncheckedStatuses.filter((s) => ALL_STATUSES.includes(s)))
  })

  // Persist on every change.
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
    (status: BookingStatus) => !uncheckedStatuses.has(status),
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

  const toggleStatus = useCallback((status: BookingStatus) => {
    setUncheckedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }, [])

  const selectAllVehicles = useCallback(() => setUncheckedVehicles(new Set()), [])
  const clearAllVehicles = useCallback(
    () => setUncheckedVehicles(new Set(knownVehicleIds)),
    [knownVehicleIds],
  )

  const filterEvents = useCallback(
    <T extends { raw: { vehicleId: string; status: BookingStatus } }>(events: T[]): T[] =>
      events.filter(
        (e) => !uncheckedVehicles.has(e.raw.vehicleId) && !uncheckedStatuses.has(e.raw.status),
      ),
    [uncheckedVehicles, uncheckedStatuses],
  )

  const filterResources = useCallback(
    <T extends { resourceId: string }>(resources: T[]): T[] =>
      resources.filter((r) => !uncheckedVehicles.has(r.resourceId)),
    [uncheckedVehicles],
  )

  return {
    isVehicleChecked,
    isStatusChecked,
    toggleVehicle,
    toggleStatus,
    selectAllVehicles,
    clearAllVehicles,
    filterEvents,
    filterResources,
  }
}
