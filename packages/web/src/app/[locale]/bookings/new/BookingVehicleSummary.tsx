import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { AvailableVehicleData, StorefrontSummaryData } from '@/modules/storefronts'
import { Car, MapPin, Settings2, Users } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'

interface BookingVehicleSummaryProps {
  vehicle: AvailableVehicleData
  storefront: StorefrontSummaryData
  from: Date
  to: Date
}

// Read-only summary of what the renter is about to book (#392): the chosen
// vehicle, the pickup storefront, and the dates carried from search.
export async function BookingVehicleSummary({
  vehicle,
  storefront,
  from,
  to,
}: BookingVehicleSummaryProps) {
  const [t, locale] = await Promise.all([getTranslations('bookings.new'), getLocale()])
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')

  return (
    <Card>
      <CardContent className="space-y-4 pt-2">
        <div>
          <p className="text-sm text-muted-foreground">{storefront.operatorName}</p>
          <h2 className="text-xl font-semibold leading-tight">{vehicle.name}</h2>
          <p className="text-sm text-muted-foreground">{vehicle.classLabel}</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: vehicle.seats })}
          </span>
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" />
            {transmissionLabel}
          </span>
          {vehicle.dailyRateJpy != null && (
            <span className="flex items-center gap-1.5">
              <Car className="size-4" />
              {formatJpy(vehicle.dailyRateJpy)}
              {t('perDay')}
            </span>
          )}
        </div>
        <div className="border-t pt-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <MapPin className="size-4 shrink-0" />
            {storefront.name}
          </p>
          <p className="mt-0.5 pl-6 text-muted-foreground">{storefront.address}</p>
        </div>
        <dl className="grid grid-cols-2 gap-2 border-t pt-4 text-sm">
          <dt className="text-muted-foreground">{t('pickupDate')}</dt>
          <dd className="text-right">{formatDateTime(from, locale)}</dd>
          <dt className="text-muted-foreground">{t('returnDate')}</dt>
          <dd className="text-right">{formatDateTime(to, locale)}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}
