import { useSession } from '@/vite/session'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { AssignVehicleDialog } from './AssignVehicleDialog'
import { needsAssignmentQueryOptions, substitutionCandidatesQueryOptions } from './api'
import type { RawOperatorBooking } from './schema'

// #464: per-float row that lazily loads substitution candidates. Candidates are
// fetched eagerly once the row mounts (there are few floats for a 40-50 car
// operator), so the dialog has them ready when the operator opens it without a
// loading flicker. `staleTime` is inherited from substitutionCandidatesQueryOptions.
function FloatRow({ float, csrfToken }: { float: RawOperatorBooking; csrfToken: string }) {
  const t = useTranslations('business.bookings.calendar.sidebar.floats')
  const candidatesQuery = useQuery(substitutionCandidatesQueryOptions(float.id))

  const windowLabel = `${new Date(float.startAt).toLocaleDateString()} – ${new Date(float.endAt).toLocaleDateString()}`
  const renterLabel = float.renter?.name ?? float.renter?.email ?? null

  return (
    <li className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{float.bookingCode}</span>
            {float.status === 'ACTIVE' && (
              <span
                className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-xs font-semibold text-destructive"
                aria-label={t('overdue')}
              >
                {t('overdue')}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{windowLabel}</div>
          {renterLabel !== null && (
            <div className="truncate text-xs text-muted-foreground">{renterLabel}</div>
          )}
        </div>
        <div className="shrink-0">
          <AssignVehicleDialog
            bookingId={float.id}
            candidates={candidatesQuery.data ?? []}
            candidatesError={candidatesQuery.isError}
            csrfToken={csrfToken}
          />
        </div>
      </div>
    </li>
  )
}

// #464: sidebar section listing all CLASS_COMBO float bookings that still need a
// concrete car assigned (assignedVehicleId null, status CONFIRMED or ACTIVE).
// Sorts ACTIVE ("overdue" — pickup window has started) above CONFIRMED so the
// most urgent floats surface first. Invalidated automatically on a successful
// assign via AssignVehicleDialog's onSuccess cache invalidation.
// #1230 slice 5a: the picked operator is threaded in as a prop (lifted to the
// route via useOperatorContext) so this leaf stays router-agnostic and unit-
// testable. undefined = no pick / operator session -> session-scoped read.
export function UnassignedFloatsList({
  pickedOperatorId,
}: { pickedOperatorId?: string | undefined }) {
  const t = useTranslations('business.bookings.calendar.sidebar.floats')
  const session = useSession()
  const csrfToken = session.data?.csrfToken ?? ''

  const { data: floats = [] } = useQuery(needsAssignmentQueryOptions(pickedOperatorId))

  // ACTIVE (pickup window started = overdue) sorts above CONFIRMED.
  const sorted = [...floats].sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
    if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1
    return 0
  })

  return (
    <section className="space-y-2" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">{t('title')}</h3>
        {floats.length > 0 && (
          <output
            aria-label={`${floats.length} unassigned floats`}
            className="inline-flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
          >
            {floats.length}
          </output>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={t('title')}>
          {sorted.map((float) => (
            <FloatRow key={float.id} float={float} csrfToken={csrfToken} />
          ))}
        </ul>
      )}
    </section>
  )
}
