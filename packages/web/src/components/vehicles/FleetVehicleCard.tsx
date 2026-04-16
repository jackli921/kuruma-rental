'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ExpiryBadge } from '@/components/vehicles/ExpiryBadge'
import { VehicleStatusToggle } from '@/components/vehicles/VehicleStatusToggle'
import { Link } from '@/i18n/routing'
import { formatVehicleRate } from '@/lib/format'
import type { VehicleData } from '@/lib/vehicle-api'
import { computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { Car, MoreHorizontal, Wrench } from 'lucide-react'
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

  const specParts = [
    `${vehicle.seats}`,
    vehicle.transmission === 'AUTO' ? 'AT' : 'MT',
    vehicle.fuelType,
  ].filter((p): p is string => Boolean(p))

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {/* Checkbox */}
      {vehicle.status !== 'RETIRED' ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(vehicle.id)}
          className="size-4 shrink-0 rounded border-border accent-primary"
          aria-label={`Select ${vehicle.name}`}
        />
      ) : (
        <div className="size-4 shrink-0" />
      )}

      {/* Thumbnail */}
      <Link
        href={`/manage/vehicles/${vehicle.id}`}
        className="relative shrink-0 h-14 w-20 overflow-hidden rounded bg-muted"
      >
        {photo ? (
          <Image
            src={photo}
            alt={vehicle.name}
            fill
            className="object-cover"
            sizes="80px"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="size-5 text-muted-foreground/30" />
          </div>
        )}
      </Link>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/manage/vehicles/${vehicle.id}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {vehicle.name}
          </Link>
          <VehicleStatusToggle vehicle={vehicle} />
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {specParts.join(' · ')}
          {price ? ` · ${price}` : ''}
        </div>
        {vehicle.status === 'MAINTENANCE' && vehicle.activeMaintenanceReason && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
            <Wrench className="size-3 shrink-0" />
            {vehicle.activeMaintenanceReason}
          </p>
        )}
        {(vehicle.shakenExpiryDate != null || vehicle.insuranceExpiryDate != null) && (
          <div className="mt-1 flex gap-1">
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
      </div>

      {/* Actions */}
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t('fleet.moreActions')}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(vehicle)}>{t('editVehicle')}</DropdownMenuItem>
            {vehicle.status !== 'RETIRED' && (
              <DropdownMenuItem onClick={() => onRetire(vehicle)}>
                {t('retireVehicle')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
