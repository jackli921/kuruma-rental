import { useState } from 'react'

export type FleetViewMode = 'row' | 'grid'

const STORAGE_KEY = 'kuruma-fleet-view-mode'

function isViewMode(v: unknown): v is FleetViewMode {
  return v === 'row' || v === 'grid'
}

// localStorage-backed persistence for the operator's preferred fleet layout
// (#561). This is a client-rendered SPA, so the stored value is read in the
// lazy useState initializer — no SSR paint to stay consistent with, and no
// row->grid flash for grid-preferring operators. Returns a [value, setter]
// tuple like useState; the setter writes through to storage.
export function useFleetViewMode(): readonly [FleetViewMode, (next: FleetViewMode) => void] {
  const [mode, setMode] = useState<FleetViewMode>(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isViewMode(raw) ? raw : 'row'
  })

  const update = (next: FleetViewMode) => {
    setMode(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  return [mode, update] as const
}
