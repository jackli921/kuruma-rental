'use client'

import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import type { VehicleClassData } from '@/modules/classes'
import { groupVehiclesByClass } from '@/modules/vehicles'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, useMemo, useState } from 'react'

interface FleetGroupedListProps {
  readonly vehicles: readonly FleetVehicleOverviewData[]
  readonly classes: readonly VehicleClassData[]
  readonly renderVehicle: (vehicle: FleetVehicleOverviewData) => ReactNode
}

// Collapsible sections of vehicles grouped by class. Unassigned vehicles
// (null classId, or a classId no longer in the classes list) fall into a
// trailing group so the owner can spot and reassign them. Collapse state
// is per-group and client-local; re-initialised on mount.
export function FleetGroupedList({ vehicles, classes, renderVehicle }: FleetGroupedListProps) {
  const t = useTranslations('business.vehicles')
  const groups = useMemo(
    () => groupVehiclesByClass(vehicles, classes, t('group.unassigned')),
    [vehicles, classes, t],
  )

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  if (groups.length === 0) return null

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const key = group.classId ?? '__unassigned__'
        const isCollapsed = collapsed.has(key)
        return (
          <section key={key} aria-label={group.className}>
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 text-left border-b border-border pb-2 mb-4 hover:bg-muted/30 rounded-sm px-1 -mx-1 transition-colors"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              )}
              <h2 className="text-lg font-semibold tracking-tight flex-1">{group.className}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('group.vehicleCount', { count: group.vehicles.length })}
              </span>
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {group.vehicles.map((vehicle) => renderVehicle(vehicle))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
