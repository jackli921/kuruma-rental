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
  // Top-level select-all over every visible vehicle, mirroring the row view's
  // header control (#596). allSelected/someSelected are computed by the parent.
  readonly allSelected: boolean
  readonly someSelected: boolean
  readonly onToggleAll: () => void
  // Per-group select-all: toggles a whole class on/off together (#596).
  readonly onToggleGroup: (ids: readonly string[]) => void
  readonly onToggleSelect: (id: string) => void
  readonly onEdit: (vehicle: OperatorFleetVehicle) => void
  // False for bypass roles: cards drop their checkbox + actions (#598).
  readonly canWrite: boolean
  readonly todayIso: string
  // Threaded to each card for the name → detail link (#527).
  readonly locale: string
  /** All-mode only: resolves the per-vehicle operator label; undefined ⇒ no badge (#1264). */
  readonly operatorNameFor?: ((vehicle: OperatorFleetVehicle) => string | undefined) | undefined
  /** #1260: the operator a picker-admin picked, bound onto each card write; undefined for operator sessions. */
  readonly pickedOperatorId?: string | undefined
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
  allSelected,
  someSelected,
  onToggleAll,
  onToggleGroup,
  onToggleSelect,
  onEdit,
  canWrite,
  todayIso,
  locale,
  operatorNameFor,
  pickedOperatorId,
}: FleetGridProps) {
  const t = useTranslations('business.vehicles.group')
  const tBulk = useTranslations('business.vehicles.bulk')

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
      {canWrite && (
        <label className="-mx-1 flex items-center gap-2 px-1 font-medium text-muted-foreground text-sm">
          <input
            type="checkbox"
            ref={(el) => {
              if (el) el.indeterminate = someSelected
            }}
            aria-label={tBulk('selectAll')}
            checked={allSelected}
            onChange={onToggleAll}
            className="shrink-0"
          />
          {tBulk('selectAll')}
        </label>
      )}
      {groups.map((group) => {
        const key = group.classId ?? UNASSIGNED_KEY
        const isCollapsed = collapsed.has(key)
        // `vehicles` is already filtered to visible rows by the container, so
        // these ids are always visible and reading raw `selectedIds` (not the
        // parent's effectiveSelectedIds) can't pick up a stale hidden selection.
        const ids = group.vehicles.map((v) => v.id)
        const groupAll = ids.length > 0 && ids.every((id) => selectedIds.includes(id))
        const groupSome = !groupAll && ids.some((id) => selectedIds.includes(id))
        return (
          <section key={key} aria-label={group.className}>
            <div className="-mx-1 mb-4 flex items-center gap-2 rounded-sm border-border border-b px-1 pb-2">
              {canWrite && (
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = groupSome
                  }}
                  aria-label={tBulk('selectGroup', { group: group.className })}
                  checked={groupAll}
                  onChange={() => onToggleGroup(ids)}
                  className="shrink-0"
                />
              )}
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={!isCollapsed}
                className="flex flex-1 items-center gap-2 rounded-sm text-left transition-colors hover:bg-muted/30"
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
            </div>
            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.vehicles.map((vehicle) => (
                  <FleetVehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    selected={selectedIds.includes(vehicle.id)}
                    onToggleSelect={onToggleSelect}
                    onEdit={() => onEdit(vehicle)}
                    canWrite={canWrite}
                    todayIso={todayIso}
                    locale={locale}
                    operatorNameFor={operatorNameFor}
                    pickedOperatorId={pickedOperatorId}
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
