'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
import { EditVehicleDialog } from '@/components/vehicles/EditVehicleDialog'
import { FleetFilters } from '@/components/vehicles/FleetFilters'
import { FleetVehicleCard } from '@/components/vehicles/FleetVehicleCard'
import { RetireVehicleDialog } from '@/components/vehicles/RetireVehicleDialog'
import {
  type FleetFilterState,
  type SortOrder,
  filterVehicles,
  sortVehicles,
} from '@/lib/fleet-filters'
import type { VehicleData } from '@/lib/vehicle-api'
import { fetchVehicles } from '@/lib/vehicle-api'
import { useQuery } from '@tanstack/react-query'
import { Car, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const DEFAULT_SEATS_BOUNDS = { min: 2, max: 10 } as const

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

export function VehicleList() {
  const t = useTranslations('business.vehicles')
  const [filters, setFilters] = useState<FleetFilterState>({
    statuses: ['AVAILABLE', 'MAINTENANCE'],
  })
  const [sort, setSort] = useState<SortOrder>('name-asc')
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null)
  const [retiringVehicle, setRetiringVehicle] = useState<VehicleData | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => fetchVehicles(),
  })

  const seatsBounds = useMemo(() => {
    if (!vehicles || vehicles.length === 0) {
      return DEFAULT_SEATS_BOUNDS
    }
    const seats = vehicles.map((v) => v.seats)
    return {
      min: Math.min(...seats),
      max: Math.max(...seats),
    }
  }, [vehicles])

  const displayed = useMemo(
    () => sortVehicles(filterVehicles(vehicles ?? [], filters), sort),
    [vehicles, filters, sort],
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
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addVehicle')}
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="h-80 rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && displayed.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {displayed.map((vehicle) => (
              <FleetVehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                onEdit={setEditingVehicle}
                onRetire={setRetiringVehicle}
              />
            ))}
          </div>
        )}

        {!isLoading && displayed.length === 0 && (
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
