'use client'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
import { BulkActionBar } from '@/components/vehicles/BulkActionBar'
import { EditVehicleDialog } from '@/components/vehicles/EditVehicleDialog'
import { FleetFilters } from '@/components/vehicles/FleetFilters'
import { FleetGroupedList } from '@/components/vehicles/FleetGroupedList'
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
import { vehicleKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
import { classKeys, fetchClassesAction } from '@/modules/classes'
import { fetchLocationsAction, locationKeys } from '@/modules/locations'
import { fetchOperatorsAction, operatorKeys } from '@/modules/operators'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Car, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'

const DEFAULT_SEATS_BOUNDS = { min: 2, max: 10 } as const
const PAGE_SIZE = 10

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

export function VehicleList() {
  const t = useTranslations('business.vehicles')
  const [filters, setFiltersRaw] = useState<FleetFilterState>({
    statuses: ['AVAILABLE', 'MAINTENANCE'],
  })
  // Default sort is utilization-desc — the owner wants to see which
  // cars are earning the most first. See issue #52.
  const [sort, setSortRaw] = useState<SortOrder>('utilization-desc')

  const setFilters = useCallback(
    (f: FleetFilterState | ((prev: FleetFilterState) => FleetFilterState)) => {
      setFiltersRaw(f)
      setPage(0)
    },
    [],
  )

  const setSort = useCallback((s: SortOrder) => {
    setSortRaw(s)
    setPage(0)
  }, [])
  const [viewMode, setViewMode] = useFleetViewMode()
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null)
  const [retiringVehicle, setRetiringVehicle] = useState<VehicleData | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [page, setPage] = useState(0)

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
    queryKey: vehicleKeys.fleetOverview,
    queryFn: async () => {
      const result = await fetchFleetOverviewAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  // Classes power the grouping sections and the class dropdown inside the
  // add/edit dialogs. Archived classes are excluded explicitly — they must
  // never appear as assignment targets. Shares the same query key as the
  // Classes page so navigating between the two doesn't double-fetch.
  const { data: classes } = useQuery({
    queryKey: classKeys.list(),
    queryFn: async () => {
      const result = await fetchClassesAction({ includeArchived: false })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  // #407: operators power the admin picker in the add dialog. The picker only
  // shows when 2+ exist; the create body always carries an explicit operatorId.
  const { data: operators } = useQuery({
    queryKey: operatorKeys.list(),
    queryFn: async () => {
      const result = await fetchOperatorsAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  // #435: locations power the pickup-location dropdown in the add/edit dialogs.
  // `includeAll: true` lets bypass-scope admins (PLATFORM_ADMIN) read across
  // operators — without it GET /locations 400s for them, leaving the picker
  // empty on exactly the operator-picker path this supports. Operator-scoped
  // callers ignore the flag and auto-scope. Active-only (archived must never be
  // an assignment target). Own cache key — `list()` is the archived-including
  // Locations-page list, so sharing it would leak archived rows into the picker.
  const { data: locations } = useQuery({
    queryKey: locationKeys.assignable(),
    queryFn: async () => {
      const result = await fetchLocationsAction({ includeAll: true })
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

  // Grouping is the default Fleet view when at least one class is
  // defined. With 40-50 vehicles across a handful of classes, showing
  // every group at once is cheaper for the owner than paging. The flat
  // paginated view is kept only for the no-classes-yet fallback.
  const hasClasses = (classes?.length ?? 0) > 0
  const useGroupedView = hasClasses && viewMode === 'grid'

  // Reset to first page when filters/sort change the result set
  const displayedLen = displayed.length
  const totalPages = Math.max(1, Math.ceil(displayedLen / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PAGE_SIZE
  const paged = displayed.slice(pageStart, pageStart + PAGE_SIZE)

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

      <div className="flex-1 min-w-0 space-y-6">
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
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
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
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground mr-2">
                  {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, displayedLen)} of {displayedLen}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Row view: desktop-only. On mobile, card grid below is the fallback. */}
        {!isLoading && !isError && paged.length > 0 && viewMode === 'row' && (
          <div className="hidden md:block space-y-2">
            {paged.map((overview) => (
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

        {!isLoading && !isError && useGroupedView && classes && displayed.length > 0 && (
          <FleetGroupedList
            vehicles={displayed}
            classes={classes}
            renderVehicle={(overview) => (
              <FleetVehicleCard
                key={overview.id}
                vehicle={overview}
                selected={selectedIds.has(overview.id)}
                onToggleSelect={toggleSelect}
                onEdit={setEditingVehicle}
                onRetire={setRetiringVehicle}
              />
            )}
          />
        )}

        {!isLoading && !isError && !useGroupedView && paged.length > 0 && (
          <div
            className={cn(
              'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6',
              viewMode === 'row' && 'md:hidden',
            )}
          >
            {paged.map((overview) => (
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

        {/* Pagination — disabled in grouped view; owners need the full class
            picture at once, not paginated slices. */}
        {!isLoading && !isError && !useGroupedView && totalPages > 1 && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, displayedLen)} of {displayedLen}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={safePage === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-3 text-sm tabular-nums">
                {safePage + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !isError && displayed.length === 0 && (
          <div className="text-center py-20">
            <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">{t('empty')}</p>
          </div>
        )}

        <AddVehicleDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          classes={classes}
          locations={locations}
          operators={operators}
        />
        <EditVehicleDialog
          vehicle={editingVehicle}
          onOpenChange={() => setEditingVehicle(null)}
          classes={classes}
          locations={locations}
        />
        <RetireVehicleDialog
          vehicle={retiringVehicle}
          onOpenChange={() => setRetiringVehicle(null)}
        />

        <BulkActionBar selectedIds={selectedIds} onClearSelection={clearSelection} />
      </div>
    </div>
  )
}
