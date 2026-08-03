// One-way custody network §4/§7/§8 — the movement-stream fold + drop-off
// policy, pure (FC/IS). The materialized vehicles.physicalLocationId IS the
// fold evaluated at `now` so future feasibility only needs the PENDING legs
// (receivedAt and voidedAt both NULL) layered on top of that baseline.
import type { MovementLegKind } from '../enums'

/** A not-yet-arrived, not-voided movement leg (the live projection). */
export interface PendingLeg {
  readonly kind: MovementLegKind
  readonly fromLocationId: string
  readonly toLocationId: string
  readonly plannedStartAt: Date
  readonly plannedEndAt: Date
  readonly departedAt: Date | null
}

/**
 * Where the vehicle is expected at instant `t`: the destination of the latest
 * pending leg whose projection has settled (`plannedEndAt <= t`), else where it
 * physically is now (`null` while IN_TRANSIT/untracked). Under §8 this is used
 * ONLY to exclude — a projected destination is never searchable (Q3-strict).
 */
export function projectedLocationAt(
  currentLocationId: string | null,
  pendingLegs: readonly PendingLeg[],
  t: Date,
): string | null {
  let latest: PendingLeg | undefined
  for (const l of pendingLegs) {
    if (l.plannedEndAt.getTime() <= t.getTime()) {
      if (!latest || l.plannedEndAt.getTime() > latest.plannedEndAt.getTime()) latest = l
    }
  }
  return latest ? latest.toLocationId : currentLocationId
}

/**
 * §8 rule 4: does any pending leg's occupancy window intersect
 * `[startAt, effectiveEndAt)`? For RENTAL legs this duplicates the DB exclusion
 * constraint (defense in depth); for STAFF_REPOSITION/TRANSFER legs it is the
 * only guard — they are not bookings, so `bookings_no_overlap` never sees them.
 */
export function pendingLegOverlaps(
  pendingLegs: readonly PendingLeg[],
  startAt: Date,
  effectiveEndAt: Date,
): boolean {
  return pendingLegs.some((l) => {
    const occupiedFrom = (l.departedAt ?? l.plannedStartAt).getTime()
    return occupiedFrom < effectiveEndAt.getTime() && startAt.getTime() < l.plannedEndAt.getTime()
  })
}

/**
 * §7 building block, formalized against the real columns: the ACTIVE locations
 * of a (not-deactivated) owner.
 */
export function ownerActiveLocationIds(args: {
  ownerOperatorId: string
  ownerDeactivatedAt: Date | null
  locations: readonly { id: string; operatorId: string; status: string }[]
}): Set<string> {
  if (args.ownerDeactivatedAt !== null) return new Set()
  return new Set(
    args.locations
      .filter((l) => l.operatorId === args.ownerOperatorId && l.status === 'ACTIVE')
      .map((l) => l.id),
  )
}

/**
 * §7 rev.7 — the v1 leash over TWO location sets. The receiving set is who may
 * take custody (owner branches ∪ opted-in foreign hosts); the owner set is
 * where "home" may point. Slice 1 passes receiving == ownerActive (no opt-in
 * yet); the shape already carries Slice 2. At home: the whole receiving set
 * (the one permitted hop out). Displaced at P: ({home} ∩ ownerActive) ∪
 * ({P} ∩ receiving) — return home or a round trip in place, never onward.
 * The pickup is the car's PHYSICAL location (§8 anchor — never a projection).
 * Search and checkout must share this one function — never re-derive it.
 */
export function allowedDropoffIds(args: {
  physicalPickupLocationId: string
  homeBaseLocationId: string | null
  ownerActiveLocationIds: ReadonlySet<string>
  receivingLocationIds: ReadonlySet<string>
}): Set<string> {
  const {
    physicalPickupLocationId: pickup,
    homeBaseLocationId: home,
    ownerActiveLocationIds: ownerActive,
    receivingLocationIds: receiving,
  } = args
  if (home !== null && pickup === home) return new Set(receiving)
  const out = new Set<string>()
  if (home !== null && ownerActive.has(home)) out.add(home)
  if (receiving.has(pickup)) out.add(pickup)
  return out
}
