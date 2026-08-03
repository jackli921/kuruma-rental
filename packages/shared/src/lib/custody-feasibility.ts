// One-way custody network §8 — THE one feasibility predicate, shared verbatim
// by search and checkout (read/write parity: search must never advertise a car
// checkout would reject). Q3-STRICT: the pickup anchor is the physically
// received location; the movement projection has exactly one job — EXCLUDING
// windows the car will not be there for. A planned/in-flight leg never makes
// its destination bookable (that needs the arrival receipt). Rule 1 (presence:
// isCustodyListable + road-legality + operator active) is composed by the
// caller against the car's CURRENT state; this module owns rules 2-5 + tail.
import {
  type PendingLeg,
  allowedDropoffIds,
  pendingLegOverlaps,
  projectedLocationAt,
} from './custody-timeline'

export const ONE_WAY_CUSTODY_REASONS = [
  'WINDOW_OVERLAPS_MOVEMENT',
  'PICKUP_NOT_AT_LOCATION',
  'ONEWAY_NOT_TAIL',
  'DROPOFF_NOT_HOMEWARD',
] as const
export type OneWayCustodyReason = (typeof ONE_WAY_CUSTODY_REASONS)[number]

export type CustodyFeasibility = { ok: true } | { ok: false; reason: OneWayCustodyReason }

export function assessOneWayFeasibility(args: {
  physicalLocationId: string | null
  pendingLegs: readonly PendingLeg[]
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  effectiveEndAt: Date
  homeBaseLocationId: string | null
  ownerActiveLocationIds: ReadonlySet<string>
  receivingLocationIds: ReadonlySet<string>
}): CustodyFeasibility {
  // Rule 2 (anchor) — pickup IS where the car was last received. No promotion.
  if (args.physicalLocationId === null || args.pickupLocationId !== args.physicalLocationId) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }
  // Rule 3 (projection excludes) — any live leg settling before the window that
  // lands anywhere else means the car will be gone, and its destination is not
  // received, so the car is bookable NOWHERE for this window.
  if (
    projectedLocationAt(args.physicalLocationId, args.pendingLegs, args.startAt) !==
    args.physicalLocationId
  ) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }
  // Rule 4 (overlap) — no live leg may occupy any part of the window.
  if (pendingLegOverlaps(args.pendingLegs, args.startAt, args.effectiveEndAt)) {
    return { ok: false, reason: 'WINDOW_OVERLAPS_MOVEMENT' }
  }
  // Rule 5 (leash) — §7 over the receiving/owner sets.
  const allowed = allowedDropoffIds({
    physicalPickupLocationId: args.pickupLocationId,
    homeBaseLocationId: args.homeBaseLocationId,
    ownerActiveLocationIds: args.ownerActiveLocationIds,
    receivingLocationIds: args.receivingLocationIds,
  })
  if (!allowed.has(args.dropoffLocationId)) {
    return { ok: false, reason: 'DROPOFF_NOT_HOMEWARD' }
  }
  // A round trip leaves the car where it was — successors stay anchored.
  if (args.dropoffLocationId === args.pickupLocationId) return { ok: true }
  // Tail rule (decision 15): a one-way must not strand an existing future leg's
  // pickup — rule 3's guarantee must survive this create.
  const hasSuccessor = args.pendingLegs.some(
    (l) => (l.departedAt ?? l.plannedStartAt).getTime() >= args.effectiveEndAt.getTime(),
  )
  if (hasSuccessor) return { ok: false, reason: 'ONEWAY_NOT_TAIL' }
  return { ok: true }
}
