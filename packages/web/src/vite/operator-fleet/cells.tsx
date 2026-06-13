import { formatVehicleRate } from '@/lib/format'
import type { OperatorFleetVehicle, VehicleStatus } from '@/vite/operator-fleet/api'
import type { ExpiryStatus } from '@kuruma/shared/lib/expiry'

// Presentational cells shared by the fleet table rows and the grid cards
// (#561). Extracted from OperatorFleetView so both view modes render status,
// expiry and price identically without duplicating the colour maps.

export function priceLabel(v: OperatorFleetVehicle, t: (k: string) => string): string {
  return (
    formatVehicleRate(v.dailyRateJpy, v.hourlyRateJpy, {
      perDay: t('perDay'),
      perHour: t('perHour'),
    }) ?? t('none')
  )
}

const STATUS_PILL: Record<VehicleStatus, string> = {
  AVAILABLE: 'border-transparent bg-muted text-foreground',
  MAINTENANCE: 'border-amber-300 text-amber-700 dark:text-amber-400',
  RETIRED: 'border-transparent bg-muted text-muted-foreground',
}

export function StatusPill({ status, label }: { status: VehicleStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status]}`}
    >
      {label}
    </span>
  )
}

const EXPIRY_PILL: Record<ExpiryStatus, string> = {
  OK: 'text-muted-foreground',
  EXPIRING_SOON: 'text-amber-700 dark:text-amber-400',
  EXPIRED: 'text-destructive font-medium',
  UNKNOWN: 'text-muted-foreground',
}

export function ExpiryPill({
  status,
  labels,
}: {
  status: ExpiryStatus
  labels: Record<ExpiryStatus, string>
}) {
  return <span className={`text-xs ${EXPIRY_PILL[status]}`}>{labels[status]}</span>
}
