'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
import { EditVehicleDialog } from '@/components/vehicles/EditVehicleDialog'
import { FleetVehicleCard } from '@/components/vehicles/FleetVehicleCard'
import { RetireVehicleDialog } from '@/components/vehicles/RetireVehicleDialog'
import type { VehicleData } from '@/lib/vehicle-api'
import { fetchVehicles } from '@/lib/vehicle-api'
import { useQuery } from '@tanstack/react-query'
import { Car, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const STATUS_FILTERS = ['ALL', 'AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export function VehicleList() {
  const t = useTranslations('business.vehicles')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null)
  const [retiringVehicle, setRetiringVehicle] = useState<VehicleData | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles', statusFilter],
    queryFn: () => fetchVehicles(statusFilter === 'ALL' ? undefined : statusFilter),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter}
              variant={statusFilter === filter ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(filter)}
            >
              {t(`filter.${filter === 'ALL' ? 'all' : filter.toLowerCase()}`)}
            </Button>
          ))}
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4 mr-1.5" />
          {t('addVehicle')}
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`skeleton-${i}`} className="h-80 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && vehicles && vehicles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {vehicles.map((vehicle) => (
            <FleetVehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              onEdit={setEditingVehicle}
              onRetire={setRetiringVehicle}
            />
          ))}
        </div>
      )}

      {!isLoading && vehicles && vehicles.length === 0 && (
        <div className="text-center py-20">
          <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      )}

      <AddVehicleDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
      <EditVehicleDialog vehicle={editingVehicle} onOpenChange={() => setEditingVehicle(null)} />
      <RetireVehicleDialog vehicle={retiringVehicle} onOpenChange={() => setRetiringVehicle(null)} />
    </div>
  )
}
