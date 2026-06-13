import { useEffect, useState } from 'react'

export type FleetViewMode = 'row' | 'grid'

const STORAGE_KEY = 'kuruma-fleet-view-mode'

function isViewMode(v: unknown): v is FleetViewMode {
  return v === 'row' || v === 'grid'
}

// localStorage-backed persistence for the operator's preferred fleet layout
// (#561). Defaults to 'row' on first paint and hydrates from storage in an
// effect so SSR/initial render stays deterministic. Returns a [value, setter]
// tuple like useState; the setter writes through to storage.
export function useFleetViewMode(): readonly [FleetViewMode, (next: FleetViewMode) => void] {
  const [mode, setMode] = useState<FleetViewMode>('row')

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isViewMode(raw)) setMode(raw)
  }, [])

  const update = (next: FleetViewMode) => {
    setMode(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  return [mode, update] as const
}
