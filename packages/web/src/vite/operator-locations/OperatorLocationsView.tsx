import { Button } from '@/components/ui/button'
import { LocationStatusBadge } from '@/vite/operator-locations/LocationStatusBadge'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { Clock, MapPin, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface OperatorLocationsViewProps {
  readonly locations: readonly OperatorLocation[]
  // Optional: omitted in read-only mode (bypass roles get cross-operator oversight
  // but cannot write — a write needs a single target tenant they lack here, #529).
  // `| undefined` is explicit: the route passes `canWrite ? setX : undefined`
  // (exactOptionalPropertyTypes distinguishes absent from an explicit undefined).
  readonly onEdit?: ((l: OperatorLocation) => void) | undefined
  readonly onArchive?: ((l: OperatorLocation) => void) | undefined
}

const MINUTES_PER_HOUR = 60

// Presentational locations list + empty state (FC/IS — the route owns the
// loader / useSuspenseQuery, the pending/error boundaries, and the dialog state;
// this stays a pure function of the resolved rows + row-action callbacks, so it
// is unit-testable). Edit/archive open the route-owned dialogs via onEdit/onArchive.
export function OperatorLocationsView({
  locations,
  onEdit,
  onArchive,
}: OperatorLocationsViewProps) {
  const t = useTranslations('business.locations')

  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
        <MapPin className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {locations.map((l) => (
        <LocationRow key={l.id} location={l} onEdit={onEdit} onArchive={onArchive} />
      ))}
    </div>
  )
}

interface LocationRowProps {
  location: OperatorLocation
  onEdit?: ((l: OperatorLocation) => void) | undefined
  onArchive?: ((l: OperatorLocation) => void) | undefined
}

function LocationRow({ location: l, onEdit, onArchive }: LocationRowProps) {
  const t = useTranslations('business.locations')
  const hours = l.operatingHours
    ? t('row.hours', { open: l.operatingHours.openTime, close: l.operatingHours.closeTime })
    : t('row.alwaysOpen')
  const turnaroundHours = Math.round(l.defaultTurnaroundMinutes / MINUTES_PER_HOUR)

  return (
    <div
      data-testid="location-row"
      className="flex items-start gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-medium">{l.name}</h3>
          <LocationStatusBadge status={l.status} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{l.address}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {hours}
          </span>
          <span>{l.timezone}</span>
          <span>{t('row.turnaround', { hours: turnaroundHours })}</span>
        </div>
      </div>

      {(onEdit || onArchive) && (
        <div className="flex shrink-0 items-center gap-1">
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('editLocation')}
              onClick={() => onEdit(l)}
            >
              <Pencil className="size-4" />
            </Button>
          )}
          {onArchive && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('archiveAction')}
              onClick={() => onArchive(l)}
              disabled={l.status === 'ARCHIVED'}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
