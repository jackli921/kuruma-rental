import { VehicleBookingCalendar } from '@/components/calendar/VehicleBookingCalendar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MaintenanceHistoryCard } from '@/components/vehicles/MaintenanceHistoryCard'
import { Link } from '@/i18n/routing'
import { formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VehicleDetailData } from '@/lib/vehicle-api'
import { ArrowLeft, Calendar, Car } from 'lucide-react'
import type { getTranslations } from 'next-intl/server'
import Image from 'next/image'
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
  const photos = vehicle.photos ?? []
  const primaryPhoto = photos[0]

  const specParts = [
    t('seats', { count: vehicle.seats }),
    vehicle.transmission === 'AUTO' ? 'AT' : 'MT',
    vehicle.fuelType,
  ].filter((p): p is string => Boolean(p))

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
            <Badge variant={STATUS_VARIANT[vehicle.status] ?? 'secondary'}>{vehicle.status}</Badge>
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

      {/* HERO: Booking Calendar */}
      <VehicleBookingCalendar vehicleId={vehicle.id} />

      {/* Supporting info below the calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-lg font-medium mb-4">{t('utilization')}</h2>
            <UtilizationChart data={vehicle.utilizationLast30Days} />
          </CardContent>
        </Card>

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
      </div>

      <div className="mt-6">
        <MaintenanceHistoryCard logs={vehicle.maintenanceLogs} t={t} />
      </div>
    </div>
  )
}
