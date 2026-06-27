/**
 * One-way rentals — the pure Functional Core (#882, design §3 & §5.2).
 *
 * A vehicle's location is NOT a stored, mutable field; it is a pure FOLD over the
 * booking chain. This module owns that derivation and the feasibility rules that
 * depend on it. It performs NO I/O: callers (the booking + search shells, #1024/
 * #1025) load the legs, resolve the policy, and translate `reason` codes into
 * typed API errors. Keeping it pure makes every timeline exhaustively unit-testable
 * with plain arrays — no DB.
 *
 * Two status sets are deliberately distinct (design §3): R1 / double-booking uses
 * OCCUPANCY `{CONFIRMED, ACTIVE}` and is enforced by the Postgres exclusion
 * constraint — NOT here. Location uses MOVEMENT HISTORY `{CONFIRMED, ACTIVE,
 * COMPLETED}` = everything except CANCELLED, because a COMPLETED A→B trip is
 * precisely why the car is at B. The caller pre-filters `legs` to that set.
 */

/** A booking that actually moved the car. `effectiveEndAt` already folds in turnaround. */
export type Leg = {
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  effectiveEndAt: Date
}

/**
 * A `Leg` already filtered to movement-history status (everything except
 * CANCELLED). The brand is nominal: it cannot be forged with a plain object
 * literal. Construct one only via `toMovementLegs()`, which performs the
 * filter — that's the whole point. Pre-#1040 the invariant lived only in
 * JSDoc, so a caller loading raw DB rows would silently feed CANCELLED rows
 * into `locationAt`/`assessPickupFeasibility` and get the wrong location.
 */
export type MovementLeg = Leg & { readonly __brand: 'movement' }

/** Anything whose status is movement-history-relevant — caller maps to this. */
export type LegWithStatus = Leg & { status: string }

/**
 * The single allowed way to produce `MovementLeg[]` from raw rows. CANCELLED
 * is excluded; COMPLETED is INCLUDED (a finished A→B trip is precisely why
 * the car is at B). See module-level note on the two status sets.
 */
export function toMovementLegs<T extends LegWithStatus>(rows: readonly T[]): MovementLeg[] {
  return rows
    .filter((r) => r.status !== 'CANCELLED')
    .map((r) => ({
      pickupLocationId: r.pickupLocationId,
      dropoffLocationId: r.dropoffLocationId,
      startAt: r.startAt,
      effectiveEndAt: r.effectiveEndAt,
    })) as MovementLeg[]
}

/** The scope dial (design §4). v1 ships tail-only; FULL_CHAIN is the same code, more rules on. */
export type OneWayPolicy = 'TAIL_ONLY' | 'FULL_CHAIN'

/**
 * The ONE resolved policy value — search and creation must share it, never
 * re-derive per caller (maintainability F6). Flip here to change the product
 * behavior in lockstep across every surface.
 */
export const DEFAULT_POLICY: OneWayPolicy = 'TAIL_ONLY'

/**
 * Feasibility-rejection reason codes. Exported as a `const` tuple so callers
 * (route → error-code map, future i18n table, telemetry) can derive their
 * coverage from this SSoT — a rename here is a compile error there, not a
 * silent prod break (maintainability finding #10).
 */
export const ONE_WAY_REASONS = [
  'PICKUP_NOT_AT_LOCATION',
  'ONEWAY_NOT_TAIL',
  'DROPOFF_DISCONTINUITY',
] as const
export type OneWayReason = (typeof ONE_WAY_REASONS)[number]

export type Feasibility = { ok: true } | { ok: false; reason: OneWayReason }

/**
 * Where the vehicle is at instant `t`: the dropoff of the latest movement leg
 * that has settled (`effectiveEndAt <= t`), else its home. A pure step-function
 * over the booking timeline (design §3).
 */
export function locationAt(
  legs: readonly MovementLeg[],
  homeLocationId: string | null,
  t: Date,
): string | null {
  let settled: Leg | undefined
  for (const leg of legs) {
    if (leg.effectiveEndAt.getTime() <= t.getTime()) {
      if (!settled || leg.effectiveEndAt.getTime() > settled.effectiveEndAt.getTime()) {
        settled = leg
      }
    }
  }
  return settled ? settled.dropoffLocationId : homeLocationId
}

/**
 * Can a new booking pick up where the renter chose? Enforces R2 (pickup
 * continuity) always, plus the policy-dialed one-way rule (design §3.1, §4).
 * R1 (overlap) is the exclusion constraint's job and is assumed to hold — so
 * every other leg is wholly before or wholly after this window, never straddling.
 */
export function assessPickupFeasibility(args: {
  legs: readonly MovementLeg[]
  homeLocationId: string | null
  pickup: string
  dropoff: string
  startAt: Date
  effectiveEndAt: Date
  policy: OneWayPolicy
}): Feasibility {
  const { legs, homeLocationId, pickup, dropoff, startAt, effectiveEndAt, policy } = args

  // R2 — the car must actually be at the chosen pickup.
  if (locationAt(legs, homeLocationId, startAt) !== pickup) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }

  // Round trips (dropoff === pickup) leave the car where it was; R2 suffices.
  if (dropoff === pickup) return { ok: true }

  // One-way: the successor is the earliest leg starting at/after this window's end
  // ([closed, open) ⇒ a leg starting exactly at effectiveEndAt is a successor).
  const successors = legs.filter((l) => l.startAt.getTime() >= effectiveEndAt.getTime())
  if (successors.length === 0) return { ok: true } // tail → the car rests at the dropoff

  // TAIL_ONLY (v1): a non-tail one-way is rejected; R3 stays vacuous.
  if (policy === 'TAIL_ONLY') return { ok: false, reason: 'ONEWAY_NOT_TAIL' }

  // FULL_CHAIN: R3 — the immediate successor must hand off FROM this dropoff.
  const earliestSuccessor = successors.reduce((earliest, l) =>
    l.startAt.getTime() < earliest.startAt.getTime() ? l : earliest,
  )
  if (earliestSuccessor.pickupLocationId !== dropoff) {
    return { ok: false, reason: 'DROPOFF_DISCONTINUITY' }
  }
  return { ok: true }
}

/**
 * Cancelling a leg can STRAND a later booking that relied on the cancelled leg
 * having relocated the car (design §6). A successor is stranded if, once
 * `cancelledLeg` is removed, the car is no longer at that successor's pickup.
 * Only legs starting after the cancelled leg can be affected — R1 guarantees
 * earlier legs' locations are independent of it. `cancelledLeg` must be an
 * element of `legs` (matched by reference).
 */
export function findStrandedSuccessors(
  legs: readonly MovementLeg[],
  homeLocationId: string | null,
  cancelledLeg: MovementLeg,
): MovementLeg[] {
  const remaining = legs.filter((l) => l !== cancelledLeg)
  return remaining.filter(
    (l) =>
      l.startAt.getTime() >= cancelledLeg.effectiveEndAt.getTime() &&
      locationAt(remaining, homeLocationId, l.startAt) !== l.pickupLocationId,
  )
}
