import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IndicativeNote } from '@/vite/currency'
import { PhotoGallery } from '@/vite/storefronts/PhotoGallery'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { Link } from '@tanstack/react-router'
import { Briefcase, Settings2, Users } from 'lucide-react'
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
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')

  const priceLabel =
    vehicle.dailyRateJpy != null
      ? t('fromDaily', { price: vehicle.dailyRateJpy.toLocaleString('en-US') })
      : vehicle.hourlyRateJpy != null
        ? t('fromHourly', { price: vehicle.hourlyRateJpy.toLocaleString('en-US') })
        : t('noPrice')
  const fromPriceJpy = vehicle.dailyRateJpy ?? vehicle.hourlyRateJpy ?? null

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <PhotoGallery photos={vehicle.photos} alt={vehicle.name} />
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
        <div className="mt-auto pt-1">
          <p className="text-base font-semibold text-foreground">{priceLabel}</p>
          {fromPriceJpy != null && <IndicativeNote jpy={fromPriceJpy} />}
        </div>
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
