'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

export type FleetViewMode = 'row' | 'grid'

const STORAGE_KEY = 'kuruma-fleet-view-mode'

function isViewMode(v: unknown): v is FleetViewMode {
  return v === 'row' || v === 'grid'
}

// localStorage-backed persistence for the owner's preferred view. Lives
// next to the toggle component so consumers get one hook + one control
// and nothing else. Returns a [value, setter] tuple like useState.
export function useFleetViewMode(): readonly [FleetViewMode, (next: FleetViewMode) => void] {
  const [mode, setMode] = useState<FleetViewMode>('row')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isViewMode(raw)) {
      setMode(raw)
    }
  }, [])

  const update = (next: FleetViewMode) => {
    setMode(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }

  return [mode, update] as const
}

interface FleetViewToggleProps {
  value: FleetViewMode
  onChange: (next: FleetViewMode) => void
}

export function FleetViewToggle({ value, onChange }: FleetViewToggleProps) {
  const t = useTranslations('business.vehicles')

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('fleet.rowView')}
        aria-pressed={value === 'row'}
        className={cn('h-7 px-2', value === 'row' && 'bg-muted')}
        onClick={() => {
          if (value !== 'row') onChange('row')
        }}
      >
        <Rows3 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('fleet.gridView')}
        aria-pressed={value === 'grid'}
        className={cn('h-7 px-2', value === 'grid' && 'bg-muted')}
        onClick={() => {
          if (value !== 'grid') onChange('grid')
        }}
      >
        <LayoutGrid className="size-4" />
      </Button>
    </div>
  )
}
