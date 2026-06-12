import { LocationStatusBadge } from '@/vite/operator-locations/LocationStatusBadge'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { Clock, MapPin } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface OperatorLocationsViewProps {
  readonly locations: readonly OperatorLocation[]
}

const MINUTES_PER_HOUR = 60

// Presentational locations list + empty state (FC/IS — the route owns the
// loader / useSuspenseQuery and the pending/error boundaries; this is a pure
// function of the resolved rows, so it is unit-testable). The add / edit /
// archive affordances land in follow-up slices (#529) and are mounted here.
export function OperatorLocationsView({ locations }: OperatorLocationsViewProps) {
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
        <LocationRow key={l.id} location={l} />
      ))}
    </div>
  )
}

function LocationRow({ location: l }: { location: OperatorLocation }) {
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
    </div>
  )
}
