'use client'

import { Button } from '@/components/ui/button'
import type { LocationData } from '@/modules/locations/api'
import { LocationStatusBadge } from '@/modules/locations/components/LocationStatusBadge'
import { Clock, MapPin, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface LocationRowProps {
  location: LocationData
  onEdit: (l: LocationData) => void
  onArchive: (l: LocationData) => void
}

const MINUTES_PER_HOUR = 60

export function LocationRow({ location: l, onEdit, onArchive }: LocationRowProps) {
  const t = useTranslations('business.locations')
  const hours = l.operatingHours
    ? t('row.hours', { open: l.operatingHours.openTime, close: l.operatingHours.closeTime })
    : t('row.alwaysOpen')
  const turnaroundHours = Math.round(l.defaultTurnaroundMinutes / MINUTES_PER_HOUR)

  return (
    <div
      data-testid="location-row"
      className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{l.name}</h3>
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

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(l)}
          aria-label={t('editLocation')}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onArchive(l)}
          aria-label={t('archiveAction')}
          disabled={l.status === 'ARCHIVED'}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}
