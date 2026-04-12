import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { fetchVehicleDetail } from '@/lib/vehicle-api'
import { ArrowLeft, Calendar, Car, Clock, Fuel, Settings2, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { UtilizationChart } from './UtilizationChart'

interface VehicleDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

function formatJpy(amount: number): string {
  return `\u00a5${amount.toLocaleString('en-US')}`
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

export default async function ManageVehicleDetailPage({ params }: VehicleDetailPageProps) {
  const { id } = await params
  const [vehicle, t] = await Promise.all([
    fetchVehicleDetail(id),
    getTranslations('business.vehicles.detail'),
  ])

  if (!vehicle) {
    notFound()
  }

  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')
  const photos = vehicle.photos ?? []
  const primaryPhoto = photos[0]
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
          {/* Photo gallery */}
          <section aria-label={t('photos')}>
            {primaryPhoto ? (
              <div className="space-y-3">
                <div className="aspect-[16/9] overflow-hidden rounded-xl bg-muted">
                  <img
                    src={primaryPhoto}
                    alt={vehicle.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                {photos.length > 1 && (
                  <div className="grid grid-cols-4 gap-3">
                    {photos.slice(1, 5).map((photo) => (
                      <div key={photo} className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                        <img
                          src={photo}
                          alt={vehicle.name}
                          className="w-full h-full object-cover"
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

          {/* Specs card */}
          <Card>
            <CardContent className="pt-4">
              <h2 className="text-lg font-medium mb-4">{t('specs')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex items-center gap-2.5">
                  <Users className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t('seats', { count: vehicle.seats })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Settings2 className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('transmission')}</p>
                    <p className="text-sm font-medium">{transmissionLabel}</p>
                  </div>
                </div>
                {vehicle.fuelType && (
                  <div className="flex items-center gap-2.5">
                    <Fuel className="size-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('fuelType')}</p>
                      <p className="text-sm font-medium">{vehicle.fuelType}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <Clock className="size-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('buffer')}</p>
                    <p className="text-sm font-medium">
                      {t('bufferMinutes', { count: vehicle.bufferMinutes })}
                    </p>
                  </div>
                </div>
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
                        duration:
                          vehicle.minRentalHours >= 24
                            ? t('days', { count: Math.floor(vehicle.minRentalHours / 24) })
                            : t('hours', { count: vehicle.minRentalHours }),
                      })}
                    </li>
                  )}
                  {vehicle.maxRentalHours != null && (
                    <li>
                      {t('maxDuration', {
                        duration:
                          vehicle.maxRentalHours >= 24
                            ? t('days', { count: Math.floor(vehicle.maxRentalHours / 24) })
                            : t('hours', { count: vehicle.maxRentalHours }),
                      })}
                    </li>
                  )}
                  {vehicle.advanceBookingHours != null && (
                    <li>
                      {t('advanceBooking', {
                        duration:
                          vehicle.advanceBookingHours >= 24
                            ? t('days', { count: Math.floor(vehicle.advanceBookingHours / 24) })
                            : t('hours', { count: vehicle.advanceBookingHours }),
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
        </div>

        {/* Right column: revenue + upcoming bookings */}
        <div className="space-y-6">
          {/* Revenue card */}
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
                    <span className="text-base font-semibold">
                      {formatJpy(vehicle.revenueAllTime)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noRevenue')}</p>
              )}
            </CardContent>
          </Card>

          {/* Upcoming bookings */}
          <Card>
            <CardContent className="pt-4">
              <h2 className="text-lg font-medium mb-4">
                <Calendar className="inline size-4 mr-1.5 -mt-0.5" />
                {t('upcomingBookings')}
              </h2>
              {vehicle.upcomingBookings.length > 0 ? (
                <ul className="space-y-3">
                  {vehicle.upcomingBookings.map((booking) => (
                    <li key={booking.id} className="border-b last:border-0 pb-3 last:pb-0">
                      <p className="text-sm font-medium">
                        {formatDateRange(booking.startAt, booking.endAt)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {booking.renterName && (
                          <span className="text-xs text-muted-foreground">
                            {booking.renterName}
                          </span>
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
        </div>
      </div>
    </div>
  )
}
