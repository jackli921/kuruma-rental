import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { useTranslations } from 'use-intl'

interface FleetSummaryBarProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly todayIso: string
}

// Fleet-wide counts strip (#561). "On rental" reflects operational state
// (there is a currentBooking) not the status column — a vehicle can be
// AVAILABLE and currently rented at once (#52). Counts the whole fleet, not
// the filtered view, so it stays a stable snapshot as filters change.
export function FleetSummaryBar({ vehicles, todayIso }: FleetSummaryBarProps) {
  const t = useTranslations('business.vehicles.fleet.summary')

  const total = vehicles.length
  const onRental = vehicles.filter((v) => v.currentBooking !== null).length
  const available = vehicles.filter((v) => v.status === 'AVAILABLE').length
  const maintenance = vehicles.filter((v) => v.status === 'MAINTENANCE').length
  const expiring = vehicles.filter((v) => {
    const s = computeExpiryStatus(v.shakenExpiryDate, todayIso)
    const i = computeExpiryStatus(v.insuranceExpiryDate, todayIso)
    return s === 'EXPIRING_SOON' || s === 'EXPIRED' || i === 'EXPIRING_SOON' || i === 'EXPIRED'
  }).length

  const dot = (
    <span className="hidden text-muted-foreground sm:inline" aria-hidden>
      ·
    </span>
  )

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span className="font-medium text-foreground">{t('total', { n: total })}</span>
      {dot}
      <span className="text-foreground">{t('onRental', { n: onRental })}</span>
      {dot}
      <span className="text-foreground">{t('available', { n: available })}</span>
      {dot}
      <span className="text-foreground">{t('maintenance', { n: maintenance })}</span>
      {expiring > 0 && (
        <>
          {dot}
          <span className="text-destructive">{t('expiring', { n: expiring })}</span>
        </>
      )}
    </div>
  )
}
