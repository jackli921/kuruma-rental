import { UNASSIGNED_KEY, groupVehiclesByClassId } from '@/lib/fleet-grouping'
import { FleetVehicleCard } from '@/vite/operator-fleet/FleetVehicleCard'
import type { OperatorFleetVehicle, VehicleClassOption } from '@/vite/operator-fleet/api'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface FleetGridProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly classOptions: readonly VehicleClassOption[]
  readonly selectedIds: readonly string[]
  readonly onToggleSelect: (id: string) => void
  readonly onEdit: (vehicle: OperatorFleetVehicle) => void
  readonly todayIso: string
}

// Grid mode for the operator fleet (#561): vehicles grouped by class into
// collapsible sections of cards. Class display names are supplied by the
// container (the route prefetches the operator-scoped options, #528), so this
// stays presentational with no fetch of its own and no loading flash. A vehicle
// with no class — or one whose class is gone — lands in a trailing "Unassigned"
// section. Collapse state is per-group and client-local.
export function FleetGrid({
  vehicles,
  classOptions,
  selectedIds,
  onToggleSelect,
  onEdit,
  todayIso,
}: FleetGridProps) {
  const t = useTranslations('business.vehicles.group')

  const groups = useMemo(() => {
    const classNames = new Map(classOptions.map((c) => [c.id, c.name]))
    return groupVehiclesByClassId(vehicles, classNames, t('unassigned'))
  }, [vehicles, classOptions, t])

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (groups.length === 0) return null

  return (
    <div className="min-w-0 flex-1 space-y-6">
      {groups.map((group) => {
        const key = group.classId ?? UNASSIGNED_KEY
        const isCollapsed = collapsed.has(key)
        return (
          <section key={key} aria-label={group.className}>
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={!isCollapsed}
              className="-mx-1 mb-4 flex w-full items-center gap-2 rounded-sm border-border border-b px-1 pb-2 text-left transition-colors hover:bg-muted/30"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              )}
              <h2 className="flex-1 font-semibold text-lg tracking-tight">{group.className}</h2>
              <span className="text-muted-foreground text-sm tabular-nums">
                {t('vehicleCount', { count: group.vehicles.length })}
              </span>
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.vehicles.map((vehicle) => (
                  <FleetVehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    selected={selectedIds.includes(vehicle.id)}
                    onToggleSelect={onToggleSelect}
                    onEdit={() => onEdit(vehicle)}
                    todayIso={todayIso}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
