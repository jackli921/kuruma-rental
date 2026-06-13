import { Button } from '@/components/ui/button'
import { type FleetFilterState, filterVehicles } from '@/lib/fleet-filters'
import { BulkActionBar } from '@/vite/operator-fleet/BulkActionBar'
import { EditVehicleSheet } from '@/vite/operator-fleet/EditVehicleSheet'
import { FleetFilters } from '@/vite/operator-fleet/FleetFilters'
import { FleetGrid } from '@/vite/operator-fleet/FleetGrid'
import { FleetSummaryBar } from '@/vite/operator-fleet/FleetSummaryBar'
import { FleetTable } from '@/vite/operator-fleet/FleetTable'
import { FleetViewToggle } from '@/vite/operator-fleet/FleetViewToggle'
import type { OperatorFleetVehicle, VehicleClassOption } from '@/vite/operator-fleet/api'
import { useFleetViewMode } from '@/vite/operator-fleet/useFleetViewMode'
import { CarFront, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorFleetViewProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly classOptions: readonly VehicleClassOption[]
  // False for bypass roles (no operatorId): the page renders read-only — no Add,
  // no per-row/card actions, no selection, no bulk bar. See the route comment (#598).
  readonly canWrite: boolean
}

// Stateful fleet management container. The route owns the loader /
// useSuspenseQuery and the pending/error boundaries; this owns the interaction
// state (selection, filters, view mode, the edit sheet) and picks the row
// (FleetTable) or grid (FleetGrid) presentation (#561). Decision logic stays in
// the pure fleet-filters / fleet-grouping libs (FC/IS); this is the imperative
// shell that holds UI state.
export function OperatorFleetView({ vehicles, classOptions, canWrite }: OperatorFleetViewProps) {
  const t = useTranslations('business.vehicles.fleet')
  const todayIso = new Date().toISOString().slice(0, 10)
  const [view, setView] = useFleetViewMode()
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [filters, setFilters] = useState<FleetFilterState>({})
  const [sheet, setSheet] = useState<{ vehicle: OperatorFleetVehicle | null } | null>(null)

  const visibleVehicles = filterVehicles([...vehicles], filters)
  const visibleIds = visibleVehicles.map((v) => v.id)
  // Selection is reconciled against the visible rows: a row hidden by a filter
  // drops out of the effective selection so a bulk action can never touch a row
  // the operator can't see.
  const effectiveSelectedIds = visibleIds.filter((id) => selectedIds.includes(id))
  const clearSelection = () => setSelectedIds([])
  const allSelected = visibleIds.length > 0 && effectiveSelectedIds.length === visibleIds.length
  const someSelected = effectiveSelectedIds.length > 0 && !allSelected
  const toggleAll = () => setSelectedIds(allSelected ? [] : visibleIds)
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  // Grid per-group select-all (#596): select the whole class together, or clear
  // it when every member is already selected.
  const toggleGroup = (ids: readonly string[]) =>
    setSelectedIds((prev) =>
      ids.every((id) => prev.includes(id))
        ? prev.filter((id) => !ids.includes(id))
        : [...prev, ...ids.filter((id) => !prev.includes(id))],
    )
  const openEdit = (vehicle: OperatorFleetVehicle) => setSheet({ vehicle })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <FleetViewToggle value={view} onChange={setView} />
        {canWrite && (
          <Button onClick={() => setSheet({ vehicle: null })}>
            <Plus className="size-4" />
            {t('addVehicle')}
          </Button>
        )}
      </div>

      {vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
          <CarFront className="mb-4 size-12 text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <>
          <FleetSummaryBar vehicles={vehicles} todayIso={todayIso} />
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="lg:w-64 lg:shrink-0">
              <FleetFilters vehicles={vehicles} value={filters} onChange={setFilters} />
            </aside>
            {view === 'grid' ? (
              <FleetGrid
                vehicles={visibleVehicles}
                classOptions={classOptions}
                selectedIds={selectedIds}
                allSelected={allSelected}
                someSelected={someSelected}
                onToggleAll={toggleAll}
                onToggleGroup={toggleGroup}
                onToggleSelect={toggleOne}
                onEdit={openEdit}
                canWrite={canWrite}
                todayIso={todayIso}
              />
            ) : (
              <FleetTable
                vehicles={visibleVehicles}
                selectedIds={selectedIds}
                allSelected={allSelected}
                someSelected={someSelected}
                onToggleAll={toggleAll}
                onToggleOne={toggleOne}
                onEdit={openEdit}
                canWrite={canWrite}
                todayIso={todayIso}
              />
            )}
          </div>
        </>
      )}

      {canWrite && (
        <>
          <BulkActionBar
            selectedIds={effectiveSelectedIds}
            onDone={clearSelection}
            onClear={clearSelection}
          />
          <EditVehicleSheet
            open={sheet !== null}
            vehicle={sheet?.vehicle ?? null}
            onOpenChange={(next) => {
              if (!next) setSheet(null)
            }}
            onSaved={() => setSheet(null)}
          />
        </>
      )}
    </div>
  )
}
