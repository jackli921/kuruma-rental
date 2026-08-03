// One-way custody network §3/§5 — the pure custody state machine (FC/IS: the
// CustodyService shell does the I/O; this decides what the next state is).
// AT_STATION|IN_TRANSIT is possession, not ownership; atHome and hostIsOwner
// are DERIVED from location/operator, never encoded in the enum.
import type { CustodyState } from '../enums'

export interface CustodySnapshot {
  readonly custodyState: CustodyState | null
  readonly physicalHostOperatorId: string | null
  readonly physicalLocationId: string | null
}

export const CUSTODY_TRANSITION_ERRORS = [
  'NOT_AT_STATION',
  'NOT_IN_TRANSIT',
  'ALREADY_PLACED',
] as const
export type CustodyTransitionError = (typeof CUSTODY_TRANSITION_ERRORS)[number]

export type CustodyTransition =
  | { ok: true; next: CustodySnapshot }
  | { ok: false; reason: CustodyTransitionError }

/** A leg (rental or staff reposition) starts: the car leaves its station (§5 Departure). */
export function departCustody(current: CustodySnapshot): CustodyTransition {
  if (current.custodyState !== 'AT_STATION') return { ok: false, reason: 'NOT_AT_STATION' }
  return {
    ok: true,
    next: { custodyState: 'IN_TRANSIT', physicalHostOperatorId: null, physicalLocationId: null },
  }
}

/** An arrival receipt confirms where the car actually landed (§5 Arrival receipt). */
export function receiveCustody(
  current: CustodySnapshot,
  hostOperatorId: string,
  locationId: string,
): CustodyTransition {
  if (current.custodyState !== 'IN_TRANSIT') return { ok: false, reason: 'NOT_IN_TRANSIT' }
  return {
    ok: true,
    next: {
      custodyState: 'AT_STATION',
      physicalHostOperatorId: hostOperatorId,
      physicalLocationId: locationId,
    },
  }
}

/** First placement of a custody-untracked vehicle (home base assigned — the §13 on-ramp). */
export function placeCustody(
  current: CustodySnapshot,
  operatorId: string,
  locationId: string,
): CustodyTransition {
  if (current.custodyState !== null) return { ok: false, reason: 'ALREADY_PLACED' }
  return {
    ok: true,
    next: {
      custodyState: 'AT_STATION',
      physicalHostOperatorId: operatorId,
      physicalLocationId: locationId,
    },
  }
}

export function isAtHome(s: CustodySnapshot, homeBaseLocationId: string | null): boolean {
  return s.physicalLocationId !== null && s.physicalLocationId === homeBaseLocationId
}

export function isHostOwner(s: CustodySnapshot, ownerOperatorId: string): boolean {
  return s.physicalHostOperatorId !== null && s.physicalHostOperatorId === ownerOperatorId
}

/**
 * §8 rule 1 (presence). IN_TRANSIT is always off (Q3); NULL custodyState
 * (untracked legacy/unassigned) stays listable so the dark-flag behavior is
 * byte-identical to today. Window feasibility and booking overlap are separate
 * conditions layered by the caller.
 */
export function isCustodyListable(v: {
  status: string
  custodyState: CustodyState | null
  heldOffline: boolean
}): boolean {
  return v.status === 'AVAILABLE' && v.custodyState !== 'IN_TRANSIT' && !v.heldOffline
}
