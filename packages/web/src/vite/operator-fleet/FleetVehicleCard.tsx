import { FleetRowActions } from '@/vite/operator-fleet/FleetRowActions'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { ExpiryPill, StatusPill, priceLabel } from '@/vite/operator-fleet/cells'
import { computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { Link } from '@tanstack/react-router'
import { Car } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface FleetVehicleCardProps {
  readonly vehicle: OperatorFleetVehicle
  readonly selected: boolean
  readonly onToggleSelect: (id: string) => void
  readonly onEdit: () => void
  // False for bypass roles: the card drops its checkbox + actions menu (#598).
  readonly canWrite: boolean
  readonly todayIso: string
  // For the name → detail link (#527). An anchor, rendered for read-only roles too.
  readonly locale: string
}

// Grid-mode card for one fleet vehicle (#561). Carries the same per-row
// affordances as a table row — a selection checkbox, the per-row actions menu
// and Edit — so per-vehicle selection and bulk actions behave identically in
// both views. (Group + top-level select-all live in FleetGrid, #596.)
// Presentation (status / expiry / price) comes from the shared cells.
export function FleetVehicleCard({
  vehicle,
  selected,
  onToggleSelect,
  onEdit,
  canWrite,
  todayIso,
  locale,
}: FleetVehicleCardProps) {
  const t = useTranslations('business.vehicles.fleet')
  const tBulk = useTranslations('business.vehicles.bulk')
  const photo = vehicle.photos[0]

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        {canWrite && (
          <input
            type="checkbox"
            aria-label={tBulk('selectRow', { name: vehicle.name })}
            checked={selected}
            onChange={() => onToggleSelect(vehicle.id)}
            className="mt-1 shrink-0"
          />
        )}
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
          {photo ? (
            <img src={photo} alt={vehicle.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Car className="size-6 text-muted-foreground/30" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to="/$locale/manage/fleet/$vehicleId"
            params={{ locale, vehicleId: vehicle.id }}
            className="block truncate font-medium hover:underline"
          >
            {vehicle.name}
          </Link>
          <div className="truncate text-xs text-muted-foreground">
            {vehicle.licensePlate ?? t('none')}
          </div>
          <div className="mt-1">
            <StatusPill status={vehicle.status} label={t(`status.${vehicle.status}`)} />
          </div>
        </div>
        {canWrite && <FleetRowActions vehicle={vehicle} onEdit={onEdit} />}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="tabular-nums text-muted-foreground">
          {`${vehicle.seats} · ${vehicle.luggageCapacity ?? t('none')}`}
        </span>
        <span className="font-medium tabular-nums">{priceLabel(vehicle, t)}</span>
      </div>

      <ExpiryPill
        status={computeExpiryStatus(vehicle.shakenExpiryDate, todayIso)}
        labels={{
          OK: t('expiry.OK'),
          EXPIRING_SOON: t('expiry.EXPIRING_SOON'),
          EXPIRED: t('expiry.EXPIRED'),
          UNKNOWN: t('expiry.UNKNOWN'),
        }}
      />
    </div>
  )
}
