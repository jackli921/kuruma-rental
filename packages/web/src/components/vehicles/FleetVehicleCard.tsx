'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VehicleStatusToggle } from '@/components/vehicles/VehicleStatusToggle'
import { formatVehicleRate } from '@/lib/format'
import type { VehicleData } from '@/lib/vehicle-api'
import { Car, Fuel, Pencil, Settings2, Trash2, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface FleetVehicleCardProps {
  vehicle: VehicleData
  onEdit: (vehicle: VehicleData) => void
  onRetire: (vehicle: VehicleData) => void
}

export function FleetVehicleCard({ vehicle, onEdit, onRetire }: FleetVehicleCardProps) {
  const t = useTranslations('business.vehicles')
  const photo = vehicle.photos?.[0]
  const price = formatVehicleRate(vehicle.dailyRateJpy, vehicle.hourlyRateJpy, {
    perDay: t('form.perDaySuffix'),
    perHour: t('form.perHourSuffix'),
  })

  return (
    <Card>
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img src={photo} alt={vehicle.name} className="w-full h-full object-cover" />
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
        </div>
        {price && <p className="mt-3 text-sm font-medium text-foreground">{price}</p>}
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
