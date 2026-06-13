import { Button } from '@/components/ui/button'
import { isOperatorSession } from '@/vite/guards'
import { CancelBookingDialog } from '@/vite/operator-bookings/CancelBookingDialog'
import { SubstituteVehicleDialog } from '@/vite/operator-bookings/SubstituteVehicleDialog'
import {
  OPERATOR_BOOKINGS_KEY,
  type OperatorBookingDetailDto,
  type OperatorBookingStatus,
  type SubstitutionCandidate,
  updateBookingStatus,
} from '@/vite/operator-bookings/api'
import type { Session } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface BookingActionsPanelProps {
  readonly detail: OperatorBookingDetailDto
  readonly session: Session | null
  /**
   * Server-matched replacement vehicles (#616/#621) for the Substitute dialog.
   * Empty for a terminal booking (the route only fetches them while live).
   */
  readonly candidates: readonly SubstitutionCandidate[]
  /** True when the candidate fetch errored — forwarded so the Substitute dialog
   *  can tell a load failure apart from a genuinely empty list. */
  readonly candidatesError?: boolean
}

// The status a one-click "advance" moves a live booking to: CONFIRMED -> ACTIVE
// (picked up) -> COMPLETED (returned). This mirrors the server's
// VALID_BOOKING_TRANSITIONS (schema.ts) but is restated here rather than imported:
// that const lives in the drizzle schema module, and a runtime import would drag
// its pgTable() side effects into the browser bundle. The API rejects any invalid
// transition with 400, so this only governs which button we OFFER.
const ADVANCE_TARGET: Partial<Record<OperatorBookingStatus, OperatorBookingStatus>> = {
  CONFIRMED: 'ACTIVE',
  ACTIVE: 'COMPLETED',
}

// #610/#616: the operator Actions panel on the trip-detail page. It owns the
// booking lifecycle actions — advance the status (mark picked-up / returned),
// substitute the vehicle (故障车换同店同级别车), and cancel — for a LIVE booking.
//
// Bypass roles (PLATFORM_ADMIN / legacy STAFF·ADMIN — no operatorId) read the
// booking cross-operator for oversight but cannot act on it: every action needs a
// single target tenant they don't carry. So the panel is operator-only, mirroring
// fleet/classes (#581/#583/#598). The `_business` shell guard admits the page; this
// gates the actions by role (the API is the real boundary). Kept presentational —
// data (detail, session, candidates) arrives as props from the route.
export function BookingActionsPanel({
  detail,
  session,
  candidates,
  candidatesError = false,
}: BookingActionsPanelProps) {
  const t = useTranslations('bookings.operator.detail')
  const queryClient = useQueryClient()
  const csrfToken = session?.csrfToken ?? ''

  const statusMutation = useMutation({
    mutationFn: (next: OperatorBookingStatus) => updateBookingStatus(detail.id, next, csrfToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY }),
  })

  if (!isOperatorSession(session)) return null

  // A live booking (CONFIRMED/ACTIVE) is the only one with anything to act on; a
  // COMPLETED/CANCELLED trip is settled, so the panel just explains the absence.
  const advanceTarget = ADVANCE_TARGET[detail.status]

  return (
    <div className="rounded-xl border border-border px-4 py-6">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">{t('actions')}</h2>
      {advanceTarget ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={statusMutation.isPending}
            onClick={() => {
              if (!statusMutation.isPending) statusMutation.mutate(advanceTarget)
            }}
          >
            {advanceTarget === 'ACTIVE' ? t('markActive') : t('markCompleted')}
          </Button>
          <SubstituteVehicleDialog
            bookingId={detail.id}
            candidates={candidates}
            candidatesError={candidatesError}
            csrfToken={csrfToken}
          />
          {/* Only CONFIRMED bookings can be cancelled — the server 409s any other
              status. An ACTIVE (picked-up) trip is past the cancellation window, so
              we hide the button rather than offer a dead-end action. */}
          {detail.status === 'CONFIRMED' && (
            <CancelBookingDialog bookingId={detail.id} csrfToken={csrfToken} />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('settled')}</p>
      )}
      {statusMutation.isError && (
        <output className="mt-3 block text-sm text-destructive">{t('statusError')}</output>
      )}
    </div>
  )
}
