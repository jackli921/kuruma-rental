import { isOperatorSession } from '@/vite/guards'
import { SubstituteVehicleDialog } from '@/vite/operator-bookings/SubstituteVehicleDialog'
import type { OperatorBookingDetailDto } from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import { useTranslations } from 'use-intl'

interface BookingActionsPanelProps {
  readonly detail: OperatorBookingDetailDto
  readonly session: Session | null
  readonly fleet: readonly OperatorFleetVehicle[]
}

// #610: the operator Actions panel on the trip-detail page. Today it owns one
// action — vehicle substitution (故障车换同店同级别车) — but it is the home for cancel /
// status transitions next. Kept router-free (props in, no useSuspenseQuery) so the
// route owns data + chrome and this stays a pure, directly-testable unit.
//
// Bypass roles (PLATFORM_ADMIN / legacy STAFF·ADMIN — no operatorId) read the
// booking cross-operator for oversight but cannot act on it: substitution needs a
// single target tenant they don't carry. So the panel is operator-only, mirroring
// fleet/classes (#581/#583/#598). The `_business` shell guard admits the page; this
// gates the action by role + capability (the API is the real boundary).
export function BookingActionsPanel({ detail, session, fleet }: BookingActionsPanelProps) {
  const t = useTranslations('bookings.operator.detail')

  if (!isOperatorSession(session)) return null

  // The server only substitutes a live booking (409 otherwise); the renter's slot
  // is gone once the trip is completed or cancelled.
  const isSubstitutable = detail.status === 'CONFIRMED' || detail.status === 'ACTIVE'

  // Mirror the server's substitution rules so a picked car never 400s: same operator
  // (the scoped fleet read), same class, same pickup location, AVAILABLE, and not the
  // car already on the booking. `classId != null` makes the (server-impossible) null-
  // class booking explicit — the server derives a class at create time and rejects a
  // classless replacement, so we never surface unassigned cars.
  // NOTE: the server matches by *ACRISS code*, not classId (two classes may share a
  // code — schema.ts "ACRISS is a category"). Filtering on classId is a strict subset:
  // it never offers a car the server rejects, but can hide a same-ACRISS replacement
  // in a different class. The fleet row carries no ACRISS code today; widening to a
  // code-based match is a follow-up (#610 review). Conservative on purpose.
  const candidates = fleet.filter(
    (v) =>
      v.status === 'AVAILABLE' &&
      detail.classId != null &&
      v.classId === detail.classId &&
      v.pickupLocationId === detail.pickupLocationId &&
      v.id !== detail.assignedVehicleId,
  )

  return (
    <div className="rounded-xl border border-border px-4 py-6">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">{t('actions')}</h2>
      {isSubstitutable ? (
        <SubstituteVehicleDialog
          bookingId={detail.id}
          candidates={candidates}
          csrfToken={session?.csrfToken ?? ''}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('substitute.unavailable')}</p>
      )}
    </div>
  )
}
