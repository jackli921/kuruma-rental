// Pure candidate filter for operator vehicle substitution (#610, FC/IS core).
// Approximates the server's substitution rules (services/booking.ts `substitute`):
// same pickup location, AVAILABLE, and not the car already on the booking. The
// server matches the replacement by ACRISS *code*; the fleet projection carries
// no ACRISS code, so we proxy it with exact `classId` equality. That is
// stricter-or-equal: same classId always shares the same ACRISS code, so we
// never offer a car the POST would reject (400 wrong-class / 400 wrong-location /
// 400 not-available / 409 just-booked); at worst we hide a valid replacement in
// a different class row that happens to share an ACRISS code (rare). Generic over
// the vehicle shape so the caller gets its full rows back (name/plate for the UI).

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

/** A candidate enriched with the fields the picker UI renders (name + plate). */
export interface SubstitutionVehicle extends SubstitutionCandidate {
  readonly name: string
  readonly licensePlate: string | null
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
