'use client'

import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { useTranslations } from 'next-intl'

interface FleetSummaryBarProps {
  overviews: readonly FleetVehicleOverviewData[]
}

// "On rental" reflects operational state (there is a currentBooking),
// not the database status column — a vehicle can be AVAILABLE and
// currently rented at the same time. See issue #52.
export function FleetSummaryBar({ overviews }: FleetSummaryBarProps) {
  const t = useTranslations('business.vehicles')

  const total = overviews.length
  const onRental = overviews.filter((v) => v.currentBooking !== null).length
  const available = overviews.filter((v) => v.status === 'AVAILABLE').length
  const maintenance = overviews.filter((v) => v.status === 'MAINTENANCE').length

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm">
      <span className="font-medium text-foreground">{t('fleet.summary.total', { n: total })}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-foreground">{t('fleet.summary.onRental', { n: onRental })}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-foreground">{t('fleet.summary.available', { n: available })}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-foreground">{t('fleet.summary.maintenance', { n: maintenance })}</span>
    </div>
  )
}
