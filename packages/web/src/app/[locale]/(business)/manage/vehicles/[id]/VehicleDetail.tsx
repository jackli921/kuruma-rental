import { VehicleBookingCalendar } from '@/components/calendar/VehicleBookingCalendar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MaintenanceHistoryCard } from '@/components/vehicles/MaintenanceHistoryCard'
import { Link } from '@/i18n/routing'
import { formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VehicleDetailData } from '@/lib/vehicle-api'
import { ArrowLeft, Calendar, Car, Clock, Fuel, Settings2, Users } from 'lucide-react'
import type { getTranslations } from 'next-intl/server'
import Image from 'next/image'
import type { ComponentType } from 'react'
import { UtilizationChart } from './UtilizationChart'

type Translator = Awaited<ReturnType<typeof getTranslations>>

interface VehicleDetailProps {
  vehicle: VehicleDetailData
  t: Translator
}

function formatDateRange(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`
}

const SOURCE_LABELS: Record<string, string> = {
  DIRECT: 'Direct',
  TRIP_COM: 'Trip.com',
  MANUAL: 'Manual',
  OTHER: 'Other',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  AVAILABLE: 'default',
  MAINTENANCE: 'secondary',
  RETIRED: 'destructive',
}

export function VehicleDetail({ vehicle, t }: VehicleDetailProps) {
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')
  const photos = vehicle.photos ?? []
  const hasRevenue =
    vehicle.revenueLast7d > 0 || vehicle.revenueLast30d > 0 || vehicle.revenueAllTime > 0
  const hasRentalRules =
    vehicle.minRentalHours != null ||
    vehicle.maxRentalHours != null ||
    vehicle.advanceBookingHours != null

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link + header */}
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/manage/vehicles"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'gap-1.5 text-muted-foreground',
          )}
        >
          <ArrowLeft className="size-4" />
          {t('backToFleet')}
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{vehicle.name}</h1>
            <Badge variant={STATUS_VARIANT[vehicle.status] ?? 'secondary'}>{vehicle.status}</Badge>
          </div>
          {vehicle.description && (
            <p className="mt-2 text-sm text-muted-foreground">{vehicle.description}</p>
          )}
        </div>
        {(vehicle.dailyRateJpy != null || vehicle.hourlyRateJpy != null) && (
          <div className="text-right shrink-0">
            {vehicle.dailyRateJpy != null && (
              <p className="text-lg font-semibold">{formatJpy(vehicle.dailyRateJpy)}/day</p>
            )}
            {vehicle.hourlyRateJpy != null && (
              <p className="text-sm text-muted-foreground">{formatJpy(vehicle.hourlyRateJpy)}/hr</p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: photos + specs */}
        <div className="lg:col-span-2 space-y-6">
          <PhotoGallery photos={photos} name={vehicle.name} placeholder={t('photos')} />

          {/* Specs card */}
          <Card>
            <CardContent className="pt-4">
              <h2 className="text-lg font-medium mb-4">{t('specs')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SpecItem icon={Users} label={t('seats', { count: vehicle.seats })} />
                <SpecItem icon={Settings2} label={t('transmission')} value={transmissionLabel} />
                {vehicle.fuelType && (
                  <SpecItem icon={Fuel} label={t('fuelType')} value={vehicle.fuelType} />
                )}
                <SpecItem
                  icon={Clock}
                  label={t('buffer')}
                  value={t('bufferMinutes', { count: vehicle.bufferMinutes })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Rental rules */}
          {hasRentalRules && (
            <Card>
              <CardContent className="pt-4">
                <h2 className="text-lg font-medium mb-3">{t('rentalRules')}</h2>
                <ul className="space-y-1.5 text-sm">
                  {vehicle.minRentalHours != null && (
                    <li>
                      {t('minDuration', {
                        duration: formatHoursDuration(vehicle.minRentalHours, t),
                      })}
                    </li>
                  )}
                  {vehicle.maxRentalHours != null && (
                    <li>
                      {t('maxDuration', {
                        duration: formatHoursDuration(vehicle.maxRentalHours, t),
                      })}
                    </li>
                  )}
                  {vehicle.advanceBookingHours != null && (
                    <li>
                      {t('advanceBooking', {
                        duration: formatHoursDuration(vehicle.advanceBookingHours, t),
                      })}
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Utilization chart */}
          <Card>
            <CardContent className="pt-4">
              <h2 className="text-lg font-medium mb-4">{t('utilization')}</h2>
              <UtilizationChart data={vehicle.utilizationLast30Days} />
            </CardContent>
          </Card>

          {/* Booking calendar */}
          <VehicleBookingCalendar vehicleId={vehicle.id} />
        </div>

        {/* Right column: revenue + upcoming bookings */}
        <div className="space-y-6">
          <RevenueCard vehicle={vehicle} t={t} hasRevenue={hasRevenue} />
          <UpcomingBookingsCard bookings={vehicle.upcomingBookings} t={t} />
          <MaintenanceHistoryCard logs={vehicle.maintenanceLogs ?? []} t={t} />
        </div>
      </div>
    </div>
  )
}

/* ---------- Sub-components ---------- */

function formatHoursDuration(hours: number, t: Translator): string {
  return hours >= 24 ? t('days', { count: Math.floor(hours / 24) }) : t('hours', { count: hours })
}

function SpecItem({
  icon: Icon,
  label,
  value,
}: { icon: ComponentType<{ className?: string }>; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-5 text-muted-foreground shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {value && <p className="text-sm font-medium">{value}</p>}
      </div>
    </div>
  )
}

function PhotoGallery({
  photos,
  name,
  placeholder,
}: { photos: string[]; name: string; placeholder: string }) {
  const primaryPhoto = photos[0]

  return (
    <section aria-label={placeholder}>
      {primaryPhoto ? (
        <div className="space-y-3">
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-muted">
            <Image
              src={primaryPhoto}
              alt={name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 66vw"
            />
          </div>
          {photos.length > 1 && (
            <div className="grid grid-cols-4 gap-3">
              {photos.slice(1, 5).map((photo) => (
                <div
                  key={photo}
                  className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted"
                >
                  <Image
                    src={photo}
                    alt={name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 25vw, 16vw"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-[16/9] overflow-hidden rounded-xl bg-muted flex items-center justify-center">
          <Car className="size-16 text-muted-foreground/30" />
        </div>
      )}
    </section>
  )
}

function RevenueCard({
  vehicle,
  t,
  hasRevenue,
}: { vehicle: VehicleDetailData; t: VehicleDetailProps['t']; hasRevenue: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h2 className="text-lg font-medium mb-4">{t('revenue')}</h2>
        {hasRevenue ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('revenueLast7d')}</span>
              <span className="text-sm font-medium">{formatJpy(vehicle.revenueLast7d)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('revenueLast30d')}</span>
              <span className="text-sm font-medium">{formatJpy(vehicle.revenueLast30d)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">{t('revenueAllTime')}</span>
              <span className="text-base font-semibold">{formatJpy(vehicle.revenueAllTime)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noRevenue')}</p>
        )}
      </CardContent>
    </Card>
  )
}

function UpcomingBookingsCard({
  bookings,
  t,
}: { bookings: VehicleDetailData['upcomingBookings']; t: VehicleDetailProps['t'] }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <h2 className="text-lg font-medium mb-4">
          <Calendar className="inline size-4 mr-1.5 -mt-0.5" />
          {t('upcomingBookings')}
        </h2>
        {bookings.length > 0 ? (
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <li key={booking.id} className="border-b last:border-0 pb-3 last:pb-0">
                <p className="text-sm font-medium">
                  {formatDateRange(booking.startAt, booking.endAt)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {booking.renterName && (
                    <span className="text-xs text-muted-foreground">{booking.renterName}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                    {SOURCE_LABELS[booking.source] ?? booking.source}
                  </Badge>
                  <Badge
                    variant={booking.status === 'ACTIVE' ? 'default' : 'secondary'}
                    className="text-[10px] px-1.5 h-4"
                  >
                    {booking.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noUpcomingBookings')}</p>
        )}
      </CardContent>
    </Card>
  )
}
