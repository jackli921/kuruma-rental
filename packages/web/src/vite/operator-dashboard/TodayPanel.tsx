import { Button } from '@/components/ui/button'
import { isOperatorSession } from '@/vite/guards'
import {
  OPERATOR_BOOKINGS_KEY,
  type OperatorBookingStatus,
  updateBookingStatus,
} from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import type { TodayBookingRow, TodayBuckets } from '@kuruma/shared/types/overview'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, LogIn, LogOut, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslations } from 'use-intl'
import { OPERATOR_OVERVIEW_QUERY_KEY } from './api'

interface TodayPanelProps {
  readonly today: TodayBuckets
  // The panel resolves each row's vehicle *name* from the already-loaded fleet
  // query (no server vehicle join), so it only needs {id, name} — a structural
  // subset the route's OperatorFleetVehicle[] satisfies.
  readonly vehicles: readonly Pick<OperatorFleetVehicle, 'id' | 'name'>[]
  readonly session: Session | null
  readonly locale: string
}

type BucketKey = 'pickups' | 'returns' | 'overdue'

interface SectionSpec {
  readonly key: BucketKey
  readonly rows: readonly TodayBookingRow[]
  // The status a one-click advance moves the booking to (pickup -> ACTIVE,
  // return/overdue -> COMPLETED). Every row in a bucket shares one target because
  // the bucket already selected on the source status server-side.
  readonly target: OperatorBookingStatus
  readonly timeField: 'startAt' | 'endAt'
  readonly Icon: LucideIcon
  readonly actionKey: 'markPickedUp' | 'markReturned'
  readonly emptyKey: 'emptyPickups' | 'emptyReturns' | 'emptyOverdue'
}

// The buckets are JST-day-scoped server-side (a row lands in "today" by its JST
// calendar day), so pin the time to Asia/Tokyo — otherwise an off-JST viewer sees
// a time (and apparent day) that disagrees with the bucket it sits in. Format in
// the active locale so the clock convention (24h ja/zh vs 12h en) matches the rest
// of the UI rather than following the viewer's browser default.
function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

// #1102: the operator's daily dispatch board — today's pickups, returns, and any
// overdue vehicles, each a clickable row (deep-links to the trip detail) with a
// one-click advance (mark picked-up / returned). Presentational: buckets + fleet
// arrive as props from the dashboard route; only the status mutation is owned here
// (mirrors BookingActionsPanel). Operator-only: a bypass admin reads the overview
// cross-tenant (a meaningless platform-wide "today") and cannot act on a single
// tenant, so the whole panel is gated on an operator session like the other
// operator-portal write affordances (#581/#583/#598).
export function TodayPanel({ today, vehicles, session, locale }: TodayPanelProps) {
  const t = useTranslations('business.today')
  const queryClient = useQueryClient()
  const csrfToken = session?.csrfToken ?? ''

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OperatorBookingStatus }) =>
      updateBookingStatus(id, status, csrfToken),
    // The advance changes a booking's lifecycle status, so refresh the today
    // buckets AND the operator-bookings prefix — whose documented cascade (#616)
    // covers the calendar, list and detail entries in one call.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_OVERVIEW_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
    },
  })

  const vehicleNamesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles])

  if (!isOperatorSession(session)) return null

  const isRowPending = (id: string) =>
    statusMutation.isPending && statusMutation.variables?.id === id

  const sections: readonly SectionSpec[] = [
    {
      key: 'pickups',
      rows: today.pickups,
      target: 'ACTIVE',
      timeField: 'startAt',
      Icon: LogOut,
      actionKey: 'markPickedUp',
      emptyKey: 'emptyPickups',
    },
    {
      key: 'returns',
      rows: today.returns,
      target: 'COMPLETED',
      timeField: 'endAt',
      Icon: LogIn,
      actionKey: 'markReturned',
      emptyKey: 'emptyReturns',
    },
    {
      key: 'overdue',
      rows: today.overdue,
      target: 'COMPLETED',
      timeField: 'endAt',
      Icon: AlertTriangle,
      actionKey: 'markReturned',
      emptyKey: 'emptyOverdue',
    },
  ]

  return (
    <section aria-label={t('title')} className="mt-6 rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('title')}</h2>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {sections.map(({ key, rows, target, timeField, Icon, actionKey, emptyKey }) => (
          <fieldset key={key} aria-label={t(key)} className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-medium">{t(key)}</h3>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {rows.length}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <Link
                      to="/$locale/manage/bookings/$bookingId"
                      params={{ locale, bookingId: r.id }}
                      className="min-w-0 flex-1 text-sm hover:underline"
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="font-medium tabular-nums">
                          {formatTime(r[timeField], locale)}
                        </span>
                        <span className="truncate">{r.renterName ?? t('walkIn')}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {vehicleNamesById.get(r.vehicleId ?? '') ?? t('noVehicle')}
                      </span>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isRowPending(r.id)}
                      onClick={() => {
                        if (!isRowPending(r.id)) statusMutation.mutate({ id: r.id, status: target })
                      }}
                    >
                      {t(actionKey)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        ))}
      </div>
      {statusMutation.isError && (
        <output className="mt-3 block text-sm text-destructive">{t('actionError')}</output>
      )}
    </section>
  )
}
