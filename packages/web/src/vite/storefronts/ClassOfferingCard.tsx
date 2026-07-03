import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IndicativeNote } from '@/vite/currency'
import { PhotoGallery } from '@/vite/storefronts/PhotoGallery'
import type { ClassOfferingData } from '@/vite/storefronts/api'
import { Link } from '@tanstack/react-router'
import { Car, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface ClassOfferingCardProps {
  readonly offering: ClassOfferingData
  /** The storefront's location — becomes the booking's pickup/dropoff. Taken from
   *  the store's own identity, NOT `offering.location`, so a future
   *  location-vs-storefront mismatch can't silently mis-route the booking. */
  readonly locationId: string
  /** Selected JST date range (datetime-local strings), carried into the wizard. */
  readonly from: string
  readonly to: string
}

/**
 * One class-combo deal inside a storefront detail page (#464). Unlike
 * `AvailableVehicleCard`, this books a CLASS, not a physical car: the exact
 * vehicle is assigned at pickup, and the live `availableCount` stands in for a
 * single car's identity. The CTA mirrors the specific-vehicle link but carries
 * `classId` instead of `vehicleId` — a combo has no assigned car yet.
 */
export function ClassOfferingCard({ offering, locationId, from, to }: ClassOfferingCardProps) {
  const t = useTranslations('search')
  const locale = useLocale()

  const priceLabel =
    offering.dailyRateJpy != null
      ? t('fromDaily', { price: offering.dailyRateJpy.toLocaleString('en-US') })
      : offering.hourlyRateJpy != null
        ? t('fromHourly', { price: offering.hourlyRateJpy.toLocaleString('en-US') })
        : t('noPrice')
  const fromPriceJpy = offering.dailyRateJpy ?? offering.hourlyRateJpy ?? null

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <PhotoGallery photos={offering.photos} alt={offering.classLabel} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold leading-tight">{offering.classLabel}</h3>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {t('classDeal')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: offering.seats })}
          </span>
          <span className="flex items-center gap-1.5">
            <Car className="size-4" />
            {t('detail.classAvailable', { count: offering.availableCount })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('comboHint')}</p>
        <div className="mt-auto pt-1">
          <p className="text-base font-semibold text-foreground">{priceLabel}</p>
          {fromPriceJpy != null && <IndicativeNote jpy={fromPriceJpy} />}
        </div>
        <Link
          to="/$locale/bookings/new"
          params={{ locale }}
          search={{
            classId: offering.classId,
            locationId,
            from,
            to,
          }}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
        >
          {t('detail.bookClass')}
        </Link>
      </div>
    </div>
  )
}
