// Pure candidate filter for operator vehicle substitution (#610, FC/IS core).
// Mirrors the server's substitution rules (services/booking.ts `substitute`):
// the replacement must be the same ACRISS class + pickup location, AVAILABLE,
// and not the car already on the booking. Filtering on the client keeps the
// operator from ever picking a car the POST would reject (400 wrong-class /
// 400 wrong-location / 400 not-available / 409 just-booked). Generic over the
// vehicle shape so the caller gets its full rows back (name/plate for the UI).

/** The booking fields that constrain a valid replacement. */
export interface SubstitutionBooking {
  readonly classId: string | null
  readonly pickupLocationId: string
  readonly assignedVehicleId: string
}

/** The minimal vehicle fields the rules read. */
export interface SubstitutionCandidate {
  readonly id: string
  readonly classId: string | null
  readonly pickupLocationId: string | null
  readonly status: string
}

export function selectSubstitutionCandidates<V extends SubstitutionCandidate>(
  fleet: readonly V[],
  booking: SubstitutionBooking,
): V[] {
  return fleet.filter(
    (v) =>
      v.status === 'AVAILABLE' &&
      v.classId === booking.classId &&
      v.pickupLocationId === booking.pickupLocationId &&
      v.id !== booking.assignedVehicleId,
  )
}
