'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
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
import type { VehicleData } from '@/lib/vehicle-api'
import { fetchFleetOverview } from '@/lib/vehicle-api'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Car, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

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

  const {
    data: overviews,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['vehicles', 'fleet-overview'],
    queryFn: () => fetchFleetOverview(),
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

  const displayed = useMemo(
    () => sortVehicles(filterVehicles(overviews ?? [], filters), sort),
    [overviews, filters, sort],
  )

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-64 lg:sticky lg:top-20 lg:self-start shrink-0">
        <FleetFilters
          filters={filters}
          sort={sort}
          onFiltersChange={setFilters}
          onSortChange={setSort}
          seatsBounds={seatsBounds}
        />
      </aside>

      <div className="flex-1 space-y-6">
        {!isLoading && !isError && overviews && <FleetSummaryBar overviews={overviews} />}

        <div className="flex items-center justify-between gap-4">
          <FleetViewToggle value={viewMode} onChange={setViewMode} />
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

        {!isLoading && !isError && displayed.length > 0 && viewMode === 'row' && (
          <div className="space-y-2">
            {displayed.map((overview) => (
              <FleetVehicleRow
                key={overview.id}
                overview={overview}
                onEdit={setEditingVehicle}
                onRetire={setRetiringVehicle}
              />
            ))}
          </div>
        )}

        {!isLoading && !isError && displayed.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {displayed.map((overview) => (
              <FleetVehicleCard
                key={overview.id}
                vehicle={overview}
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
      </div>
    </div>
  )
}
