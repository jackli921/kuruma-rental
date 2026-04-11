'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { VehicleStatusBadge } from '@/components/vehicles/VehicleStatusBadge'
import { formatVehicleRate } from '@/lib/format'
import type { FleetBookingSummaryData, FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { Car, MoreHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface FleetVehicleRowProps {
  overview: FleetVehicleOverviewData
  onEdit: (overview: FleetVehicleOverviewData) => void
  onRetire: (overview: FleetVehicleOverviewData) => void
}

// Format a booking's end-time window for the inline row indicator. We
// show day + HH:mm in Asia/Tokyo because that's where the owner is and
// seeing "12:00" means the same thing at a glance every time.
function formatBookingTime(iso: string): string {
  const date = new Date(iso)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Tokyo',
    hour12: false,
  }).format(date)
}

function BookingIndicator({
  current,
  next,
  t,
}: {
  current: FleetBookingSummaryData | null
  next: FleetBookingSummaryData | null
  t: (key: string, values?: Record<string, string | number | Date>) => string
}) {
  if (current) {
    return (
      <span data-testid="fleet-row-booking-indicator" className="text-sm text-foreground">
        {t('fleet.onRentalUntil', { time: formatBookingTime(current.endAt) })}
      </span>
    )
  }
  if (next) {
    return (
      <span data-testid="fleet-row-booking-indicator" className="text-sm text-muted-foreground">
        {t('fleet.nextBooking', { time: formatBookingTime(next.startAt) })}
      </span>
    )
  }
  return (
    <span data-testid="fleet-row-booking-indicator" className="text-sm text-muted-foreground">
      {t('fleet.noBookings')}
    </span>
  )
}

export function FleetVehicleRow({ overview, onEdit, onRetire }: FleetVehicleRowProps) {
  const t = useTranslations('business.vehicles')
  const photo = overview.photos?.[0]
  const price = formatVehicleRate(overview.dailyRateJpy, overview.hourlyRateJpy, {
    perDay: t('form.perDaySuffix'),
    perHour: t('form.perHourSuffix'),
  })

  const subtitleParts = [
    `${overview.seats}`,
    overview.transmission === 'AUTO' ? 'AT' : 'MT',
    overview.fuelType,
  ].filter((p): p is string => Boolean(p))

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-3">
      {/* Thumbnail: 80x60 per issue spec */}
      <div className="flex-shrink-0 h-[60px] w-[80px] overflow-hidden rounded bg-muted">
        {photo ? (
          <img src={photo} alt={overview.name} className="h-full w-full object-cover" />
        ) : (
          <div
            data-testid="fleet-row-thumbnail-placeholder"
            className="flex h-full w-full items-center justify-center"
          >
            <Car className="size-6 text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Name + subtitle */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{overview.name}</div>
        <div data-testid="fleet-row-subtitle" className="truncate text-sm text-muted-foreground">
          {subtitleParts.join(' · ')}
        </div>
      </div>

      {/* Status */}
      <div className="flex-shrink-0">
        <VehicleStatusBadge status={overview.status} />
      </div>

      {/* Booking indicator */}
      <div className="flex-shrink-0 min-w-[12rem]">
        <BookingIndicator current={overview.currentBooking} next={overview.nextBooking} t={t} />
      </div>

      {/* Price */}
      <div className="flex-shrink-0 min-w-[10rem] text-right text-sm font-medium">
        {price ?? ''}
      </div>

      {/* Utilization */}
      <div
        data-testid="fleet-row-utilization"
        className="flex-shrink-0 min-w-[10rem] text-right text-sm text-muted-foreground"
      >
        {t('fleet.utilizationLabel', {
          percent: Math.round(overview.utilization),
          count: overview.bookingCountLast30Days,
        })}
      </div>

      {/* Overflow menu */}
      <div className="flex-shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={t('fleet.moreActions')}>
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(overview)}>{t('editVehicle')}</DropdownMenuItem>
            {overview.status !== 'RETIRED' && (
              <DropdownMenuItem onClick={() => onRetire(overview)}>
                {t('retireVehicle')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
