import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { Link } from '@tanstack/react-router'
import { Briefcase, Car, Settings2, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface AvailableVehicleCardProps {
  readonly vehicle: AvailableVehicleData
  /** The storefront's location — becomes the booking's pickup/dropoff. */
  readonly locationId: string
  /** Selected JST date range (datetime-local strings), carried into the wizard. */
  readonly from: string
  readonly to: string
}

/**
 * One available vehicle inside a storefront detail page (#391). The projection
 * is already renter-safe (the API drops operator internals). The booking CTA
 * carries the vehicle + storefront location + dates into the reservation wizard
 * (#460); the `_renter` guard there prompts login before booking.
 */
export function AvailableVehicleCard({ vehicle, locationId, from, to }: AvailableVehicleCardProps) {
  const t = useTranslations('search')
  const tSize = useTranslations('luggageSize')
  const locale = useLocale()
  const photo = vehicle.photos[0]
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')

  const priceLabel =
    vehicle.dailyRateJpy != null
      ? t('fromDaily', { price: vehicle.dailyRateJpy.toLocaleString('en-US') })
      : vehicle.hourlyRateJpy != null
        ? t('fromHourly', { price: vehicle.hourlyRateJpy.toLocaleString('en-US') })
        : t('noPrice')

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img src={photo} alt={vehicle.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="size-12 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base font-semibold leading-tight">{vehicle.name}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: vehicle.seats })}
          </span>
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" />
            {transmissionLabel}
          </span>
          {vehicle.luggageCapacity != null && (
            <span className="flex items-center gap-1.5">
              <Briefcase className="size-4" />
              {t('luggage', { count: vehicle.luggageCapacity })}
              {vehicle.luggageSize != null && (
                <span className="text-muted-foreground/80"> · {tSize(vehicle.luggageSize)}</span>
              )}
            </span>
          )}
        </div>
        <p className="mt-auto pt-1 text-base font-semibold text-foreground">{priceLabel}</p>
        <Link
          to="/$locale/bookings/new"
          params={{ locale }}
          search={{ vehicleId: vehicle.id, locationId, from, to }}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
        >
          {t('detail.book')}
        </Link>
      </div>
    </div>
  )
}
