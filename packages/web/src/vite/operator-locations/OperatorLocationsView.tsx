import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OperatorScope } from '@/vite/operator-context'
import { AddLocationDialog } from '@/vite/operator-locations/AddLocationDialog'
import { ArchiveLocationDialog } from '@/vite/operator-locations/ArchiveLocationDialog'
import { EditLocationDialog } from '@/vite/operator-locations/EditLocationDialog'
import { LocationPinBadge } from '@/vite/operator-locations/LocationPinBadge'
import { LocationStatusBadge } from '@/vite/operator-locations/LocationStatusBadge'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { Clock, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorLocationsViewProps {
  readonly locations: readonly OperatorLocation[]
  readonly scope: OperatorScope
}

const MINUTES_PER_HOUR = 60

// Locations list + empty state. The route owns the loader / useSuspenseQuery and
// the pending/error boundaries (FC/IS — the shell does I/O, this renders); this
// view owns the add/edit/archive dialog state and write mutations, which
// invalidate the route's LOCATIONS_QUERY_KEY on success so the list refetches.
//
// In all-mode (a cross-operator reader with no picked operator) the page is
// read-only: `canWrite` is false so no write affordances render, and
// `showOperator` turns on the per-row operator label so the mixed-tenant list is
// legible. A scoped write (operator session, or admin who picked a tenant) shows
// the Add/Edit/Archive controls and threads `pickedOperatorId` into the create.
export function OperatorLocationsView({ locations, scope }: OperatorLocationsViewProps) {
  const { pickedOperatorId, canWrite, showOperator, operatorNameById } = scope
  const t = useTranslations('business.locations')
  const [addOpen, setAddOpen] = useState(false)
  // Edit/archive open against a selected row; null = closed. Distinct state per
  // dialog so a stale edit can't bleed into an archive prompt.
  const [editing, setEditing] = useState<OperatorLocation | null>(null)
  const [archiving, setArchiving] = useState<OperatorLocation | null>(null)

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-center justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            {t('addLocation')}
          </Button>
        </div>
      )}

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
          <MapPin className="mb-4 size-12 text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((l) => (
            <LocationRow
              key={l.id}
              location={l}
              canWrite={canWrite}
              operatorName={showOperator ? operatorNameById.get(l.operatorId) : undefined}
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <AddLocationDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            pickedOperatorId={pickedOperatorId}
          />
          <EditLocationDialog
            location={editing}
            onOpenChange={(open) => !open && setEditing(null)}
          />
          <ArchiveLocationDialog
            location={archiving}
            onOpenChange={(open) => !open && setArchiving(null)}
          />
        </>
      ) : null}
    </div>
  )
}

interface LocationRowProps {
  location: OperatorLocation
  canWrite: boolean
  operatorName?: string | undefined
  onEdit: (l: OperatorLocation) => void
  onArchive: (l: OperatorLocation) => void
}

function LocationRow({ location: l, canWrite, operatorName, onEdit, onArchive }: LocationRowProps) {
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
          <LocationPinBadge coordinateSource={l.coordinateSource} />
          {operatorName && (
            <Badge variant="secondary" aria-label={`Operator: ${operatorName}`}>
              {operatorName}
            </Badge>
          )}
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

      {canWrite ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('editLocation')}
            onClick={() => onEdit(l)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('archiveAction')}
            onClick={() => onArchive(l)}
            disabled={l.status === 'ARCHIVED'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
