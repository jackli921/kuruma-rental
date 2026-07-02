import { Button } from '@/components/ui/button'
import { type FleetFilterState, filterVehicles } from '@/lib/fleet-filters'
import type { OperatorScope } from '@/vite/operator-context'
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
  // The operator-context scope (picked id, write gate, all-mode labeling). The
  // route derives it from the session + picker; the view is presentational (#1264).
  // canWrite false ⇒ read-only (no Add, no per-row/card actions, no selection, no
  // bulk bar, #598); showOperator true ⇒ each row/card carries its operator badge.
  readonly scope: OperatorScope
  // Threaded to the row/card so each vehicle name links to its detail page (#527).
  // Passed as a prop (not read from a router hook) to keep the view tree
  // router-free and unit-testable — the bookings locale-as-prop convention.
  readonly locale: string
  // Seed filter state from the URL (#916 §5.5): the dashboard compliance banner
  // deep-links here with `?expiringSoon=true` so the page opens already narrowed
  // to the non-compliant set. The route reads it via validateSearch and passes
  // it down; absent ⇒ the page opens unfiltered.
  readonly initialFilters?: FleetFilterState
}

// Stateful fleet management container. The route owns the loader /
// useSuspenseQuery and the pending/error boundaries; this owns the interaction
// state (selection, filters, view mode, the edit sheet) and picks the row
// (FleetTable) or grid (FleetGrid) presentation (#561). Decision logic stays in
// the pure fleet-filters / fleet-grouping libs (FC/IS); this is the imperative
// shell that holds UI state.
export function OperatorFleetView({
  vehicles,
  classOptions,
  scope,
  locale,
  initialFilters,
}: OperatorFleetViewProps) {
  const t = useTranslations('business.vehicles.fleet')
  const todayIso = new Date().toISOString().slice(0, 10)
  // Derived from the scope: the write gate flows to every affordance below; the
  // resolver labels rows with their operator only in all-mode (#1264).
  const { canWrite, pickedOperatorId, showOperator, operatorNameById } = scope
  const operatorNameFor = (v: OperatorFleetVehicle) =>
    showOperator ? operatorNameById.get(v.operatorId) : undefined
  const [view, setView] = useFleetViewMode()
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [filters, setFilters] = useState<FleetFilterState>(initialFilters ?? {})
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
                locale={locale}
                operatorNameFor={operatorNameFor}
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
                locale={locale}
                operatorNameFor={operatorNameFor}
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
            pickedOperatorId={pickedOperatorId}
          />
        </>
      )}
    </div>
  )
}
