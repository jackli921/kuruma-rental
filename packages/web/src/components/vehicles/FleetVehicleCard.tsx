'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpiryBadge } from '@/components/vehicles/ExpiryBadge'
import { VehicleStatusToggle } from '@/components/vehicles/VehicleStatusToggle'
import { formatVehicleRate } from '@/lib/format'
import type { VehicleData } from '@/lib/vehicle-api'
import { computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { Car, Fuel, Pencil, RectangleHorizontal, Settings2, Trash2, Users, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'

interface FleetVehicleCardProps {
  vehicle: VehicleData & { activeMaintenanceReason?: string | null }
  selected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (vehicle: VehicleData) => void
  onRetire: (vehicle: VehicleData) => void
}

export function FleetVehicleCard({
  vehicle,
  selected,
  onToggleSelect,
  onEdit,
  onRetire,
}: FleetVehicleCardProps) {
  const t = useTranslations('business.vehicles')
  const todayIso = new Date().toISOString().slice(0, 10)
  const photo = vehicle.photos?.[0]
  const price = formatVehicleRate(vehicle.dailyRateJpy, vehicle.hourlyRateJpy, {
    perDay: t('form.perDaySuffix'),
    perHour: t('form.perHourSuffix'),
  })

  return (
    <Card>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {vehicle.status !== 'RETIRED' && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(vehicle.id)}
            className="absolute top-2 left-2 z-10 size-4 rounded border-border accent-primary"
            aria-label={`Select ${vehicle.name}`}
          />
        )}
        {photo ? (
          <Image
            src={photo}
            alt={vehicle.name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 33vw"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="size-12 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{vehicle.name}</CardTitle>
          <VehicleStatusToggle vehicle={vehicle} />
        </div>
        {vehicle.status === 'MAINTENANCE' && vehicle.activeMaintenanceReason && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
            <Wrench className="size-3 shrink-0" />
            {vehicle.activeMaintenanceReason}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {vehicle.seats}
          </span>
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" />
            {vehicle.transmission === 'AUTO' ? 'AT' : 'MT'}
          </span>
          {vehicle.fuelType && (
            <span className="flex items-center gap-1.5">
              <Fuel className="size-4" />
              {vehicle.fuelType}
            </span>
          )}
          {vehicle.licensePlate && (
            <span className="flex items-center gap-1.5" aria-label={t('form.licensePlate')}>
              <RectangleHorizontal className="size-4" aria-hidden="true" />
              {vehicle.licensePlate}
            </span>
          )}
        </div>
        {price && <p className="mt-3 text-sm font-medium text-foreground">{price}</p>}
        {(vehicle.shakenExpiryDate != null || vehicle.insuranceExpiryDate != null) && (
          <div className="mt-2 flex gap-1">
            {vehicle.shakenExpiryDate != null && (
              <ExpiryBadge
                status={computeExpiryStatus(vehicle.shakenExpiryDate, todayIso)}
                label="shaken"
              />
            )}
            {vehicle.insuranceExpiryDate != null && (
              <ExpiryBadge
                status={computeExpiryStatus(vehicle.insuranceExpiryDate, todayIso)}
                label="insurance"
              />
            )}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onEdit(vehicle)}>
            <Pencil className="size-3.5 mr-1.5" />
            {t('editVehicle')}
          </Button>
          {vehicle.status !== 'RETIRED' && (
            <Button variant="outline" size="sm" onClick={() => onRetire(vehicle)}>
              <Trash2 className="size-3.5 mr-1.5" />
              {t('retireVehicle')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
