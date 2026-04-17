import { VehicleBookingCalendar } from '@/components/calendar/VehicleBookingCalendar'
import { buttonVariants } from '@/components/ui/button'
import { PhotoUpload } from '@/components/vehicles/PhotoUpload'
import { VehicleStatusBadge } from '@/components/vehicles/VehicleStatusBadge'
import { Link } from '@/i18n/routing'
import { formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VehicleDetailData } from '@/lib/vehicle-api'
import { ArrowLeft, Car } from 'lucide-react'
import type { getTranslations } from 'next-intl/server'
import Image from 'next/image'

type Translator = Awaited<ReturnType<typeof getTranslations>>

interface VehicleDetailProps {
  vehicle: VehicleDetailData
  t: Translator
}

export function VehicleDetail({ vehicle, t }: VehicleDetailProps) {
  const photos = vehicle.photos ?? []
  const primaryPhoto = photos[0]

  const specParts = [
    t('seats', { count: vehicle.seats }),
    vehicle.transmission === 'AUTO' ? 'AT' : 'MT',
    vehicle.fuelType,
  ].filter((p): p is string => Boolean(p))

  const utilization = vehicle.utilizationLast30Days
  const avgUtilization =
    utilization.length > 0
      ? Math.round(
          (utilization.reduce((sum, d) => sum + d.bookedHours, 0) / (utilization.length * 24)) *
            100,
        )
      : 0
  const nextBooking = vehicle.upcomingBookings[0]

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Back link */}
      <Link
        href="/manage/vehicles"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'gap-1.5 text-muted-foreground mb-4',
        )}
      >
        <ArrowLeft className="size-4" />
        {t('backToFleet')}
      </Link>

      {/* Compact vehicle identity header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="relative shrink-0 h-16 w-24 overflow-hidden rounded-lg bg-muted">
          {primaryPhoto ? (
            <Image
              src={primaryPhoto}
              alt={vehicle.name}
              fill
              className="object-cover"
              sizes="96px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Car className="size-6 text-muted-foreground/30" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{vehicle.name}</h1>
            <VehicleStatusBadge status={vehicle.status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            {vehicle.licensePlate && (
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {vehicle.licensePlate}
              </span>
            )}
            <span>{specParts.join(' · ')}</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          {vehicle.dailyRateJpy != null && (
            <p className="text-lg font-semibold">{formatJpy(vehicle.dailyRateJpy)}/day</p>
          )}
          {vehicle.hourlyRateJpy != null && (
            <p className="text-sm text-muted-foreground">{formatJpy(vehicle.hourlyRateJpy)}/hr</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('utilizationShort')}</p>
          <p className="text-xl font-semibold mt-0.5">{avgUtilization}%</p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('upcomingShort')}</p>
          <p className="text-xl font-semibold mt-0.5">{vehicle.upcomingBookings.length}</p>
          {nextBooking && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('nextBookingShort')}{' '}
              {new Date(nextBooking.startAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('revenueLast30dShort')}</p>
          <p className="text-xl font-semibold mt-0.5">
            {vehicle.revenueLast30d > 0 ? formatJpy(vehicle.revenueLast30d) : '--'}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('maintenanceHistory')}</p>
          <p className="text-xl font-semibold mt-0.5">{vehicle.maintenanceLogs.length}</p>
        </div>
      </div>

      {/* Booking Calendar */}
      <VehicleBookingCalendar vehicleId={vehicle.id} />

      {/* Photo management */}
      <PhotoUpload key={vehicle.id} vehicleId={vehicle.id} initialPhotos={photos} />
    </div>
  )
}
