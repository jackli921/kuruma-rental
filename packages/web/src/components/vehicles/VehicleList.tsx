'use client'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
import { BulkActionBar } from '@/components/vehicles/BulkActionBar'
import { EditVehicleDialog } from '@/components/vehicles/EditVehicleDialog'
import { FleetFilters } from '@/components/vehicles/FleetFilters'
import { FleetSummaryBar } from '@/components/vehicles/FleetSummaryBar'
import { FleetVehicleCard } from '@/components/vehicles/FleetVehicleCard'
import { FleetVehicleRow } from '@/components/vehicles/FleetVehicleRow'
import { FleetViewToggle, useFleetViewMode } from '@/components/vehicles/FleetViewToggle'
import { RetireVehicleDialog } from '@/components/vehicles/RetireVehicleDialog'
import {
  type FleetFilterState,
  type SortOrder,
  filterVehicles,
  sortVehicles,
} from '@/lib/fleet-filters'
import { cn } from '@/lib/utils'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Car, Plus, SlidersHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

const DEFAULT_SEATS_BOUNDS = { min: 2, max: 10 } as const

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

export function VehicleList() {
  const t = useTranslations('business.vehicles')
  const [filters, setFilters] = useState<FleetFilterState>({
    statuses: ['AVAILABLE', 'MAINTENANCE'],
  })
  // Default sort is utilization-desc — the owner wants to see which
  // cars are earning the most first. See issue #52.
  const [sort, setSort] = useState<SortOrder>('utilization-desc')
  const [viewMode, setViewMode] = useFleetViewMode()
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null)
  const [retiringVehicle, setRetiringVehicle] = useState<VehicleData | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const {
    data: overviews,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['vehicles', 'fleet-overview'],
    queryFn: async () => {
      const result = await fetchFleetOverviewAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const seatsBounds = useMemo(() => {
    if (!overviews || overviews.length === 0) {
      return DEFAULT_SEATS_BOUNDS
    }
    const seats = overviews.map((v) => v.seats)
    return {
      min: Math.min(...seats),
      max: Math.max(...seats),
    }
  }, [overviews])

  const availableMakes = useMemo(() => {
    if (!overviews) return []
    return [...new Set(overviews.map((v) => v.make).filter((m): m is string => m != null))].sort()
  }, [overviews])

  const availableModels = useMemo(() => {
    if (!overviews) return []
    return [...new Set(overviews.map((v) => v.model).filter((m): m is string => m != null))].sort()
  }, [overviews])

  const availableYears = useMemo(() => {
    if (!overviews) return []
    return [...new Set(overviews.map((v) => v.year).filter((y): y is number => y != null))].sort(
      (a, b) => b - a,
    )
  }, [overviews])

  const availableColors = useMemo(() => {
    if (!overviews) return []
    return [...new Set(overviews.map((v) => v.color).filter((c): c is string => c != null))].sort()
  }, [overviews])

  const displayed = useMemo(
    () => sortVehicles(filterVehicles(overviews ?? [], filters), sort),
    [overviews, filters, sort],
  )

  // Only non-RETIRED vehicles in the current filtered view are selectable
  const selectableIds = useMemo(
    () => displayed.filter((v) => v.status !== 'RETIRED').map((v) => v.id),
    [displayed],
  )

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set()
      return new Set(selectableIds)
    })
  }, [selectableIds])

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="hidden lg:block lg:w-64 lg:sticky lg:top-20 lg:self-start shrink-0">
        <FleetFilters
          filters={filters}
          sort={sort}
          onFiltersChange={setFilters}
          onSortChange={setSort}
          seatsBounds={seatsBounds}
          availableMakes={availableMakes}
          availableModels={availableModels}
          availableYears={availableYears}
          availableColors={availableColors}
        />
      </aside>

      <div className="flex-1 space-y-6">
        {!isLoading && !isError && overviews && <FleetSummaryBar overviews={overviews} />}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline" size="sm" className="lg:hidden">
                    <SlidersHorizontal className="size-4 mr-1.5" />
                    {t('filter.title')}
                  </Button>
                }
              />
              <SheetContent side="left" className="w-72 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>{t('filter.title')}</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-4">
                  <FleetFilters
                    filters={filters}
                    sort={sort}
                    onFiltersChange={setFilters}
                    onSortChange={setSort}
                    seatsBounds={seatsBounds}
                    availableMakes={availableMakes}
                    availableModels={availableModels}
                    availableYears={availableYears}
                    availableColors={availableColors}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <FleetViewToggle value={viewMode} onChange={setViewMode} />
          </div>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addVehicle')}
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="h-20 rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && isError && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 text-center">
            <AlertCircle className="size-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">{t('loadError')}</p>
            <p className="mt-1 text-xs text-muted-foreground break-words">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              {t('retry')}
            </Button>
          </div>
        )}

        {!isLoading && !isError && displayed.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="size-4 rounded border-border accent-primary"
              aria-label={allSelected ? t('bulk.deselectAll') : t('bulk.selectAll')}
            />
            <span className="text-sm text-muted-foreground">
              {allSelected ? t('bulk.deselectAll') : t('bulk.selectAll')}
            </span>
          </div>
        )}

        {!isLoading && !isError && displayed.length > 0 && viewMode === 'row' && (
          <div className="hidden md:block space-y-2">
            {displayed.map((overview) => (
              <FleetVehicleRow
                key={overview.id}
                overview={overview}
                selected={selectedIds.has(overview.id)}
                onToggleSelect={toggleSelect}
                onEdit={setEditingVehicle}
                onRetire={setRetiringVehicle}
              />
            ))}
          </div>
        )}

        {!isLoading && !isError && displayed.length > 0 && (
          <div
            className={cn(
              'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6',
              viewMode === 'row' && 'md:hidden',
            )}
          >
            {displayed.map((overview) => (
              <FleetVehicleCard
                key={overview.id}
                vehicle={overview}
                selected={selectedIds.has(overview.id)}
                onToggleSelect={toggleSelect}
                onEdit={setEditingVehicle}
                onRetire={setRetiringVehicle}
              />
            ))}
          </div>
        )}

        {!isLoading && !isError && displayed.length === 0 && (
          <div className="text-center py-20">
            <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">{t('empty')}</p>
          </div>
        )}

        <AddVehicleDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
        <EditVehicleDialog vehicle={editingVehicle} onOpenChange={() => setEditingVehicle(null)} />
        <RetireVehicleDialog
          vehicle={retiringVehicle}
          onOpenChange={() => setRetiringVehicle(null)}
        />

        <BulkActionBar selectedIds={selectedIds} onClearSelection={clearSelection} />
      </div>
    </div>
  )
}
