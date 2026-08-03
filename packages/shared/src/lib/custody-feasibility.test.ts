import { describe, expect, it } from 'vitest'
import { assessOneWayFeasibility } from './custody-feasibility'
import type { PendingLeg } from './custody-timeline'

const d = (iso: string): Date => new Date(iso)
const leg = (over: Partial<PendingLeg>): PendingLeg => ({
  kind: 'RENTAL',
  fromLocationId: 'A',
  toLocationId: 'B',
  plannedStartAt: d('2026-08-01T10:00:00Z'),
  plannedEndAt: d('2026-08-03T10:00:00Z'),
  departedAt: null,
  ...over,
})
const active = new Set(['A', 'B', 'C'])
const base = {
  physicalLocationId: 'A' as string | null,
  pendingLegs: [] as readonly PendingLeg[],
  pickupLocationId: 'A',
  dropoffLocationId: 'A',
  startAt: d('2026-09-01T10:00:00Z'),
  effectiveEndAt: d('2026-09-03T10:00:00Z'),
  homeBaseLocationId: 'A' as string | null,
  ownerActiveLocationIds: active,
  receivingLocationIds: active,
}

describe('assessOneWayFeasibility (§8 — anchor, exclude-only projection, leash, tail)', () => {
  it('round trip at home is feasible', () => {
    expect(assessOneWayFeasibility(base)).toEqual({ ok: true })
  })
  it('from home, a one-way to any receiving location is feasible as the tail', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'B' })).toEqual({ ok: true })
  })
  it('displaced at B: the homeward B→A trip is feasible (the headline case)', () => {
    expect(
      assessOneWayFeasibility({
        ...base,
        physicalLocationId: 'B',
        pickupLocationId: 'B',
        dropoffLocationId: 'A',
      }),
    ).toEqual({ ok: true })
  })
  it('displaced at B: a round trip in place (B→B) is feasible (Q1 approval)', () => {
    expect(
      assessOneWayFeasibility({
        ...base,
        physicalLocationId: 'B',
        pickupLocationId: 'B',
        dropoffLocationId: 'B',
      }),
    ).toEqual({ ok: true })
  })
  it('displaced at B: onward B→C is rejected even though C is owner-active', () => {
    expect(
      assessOneWayFeasibility({
        ...base,
        physicalLocationId: 'B',
        pickupLocationId: 'B',
        dropoffLocationId: 'C',
      }),
    ).toEqual({ ok: false, reason: 'DROPOFF_NOT_HOMEWARD' })
  })
  it('ANCHOR (rule 2): the pickup must be the physically received location — never a projection', () => {
    // Car at A with a pending A→B leg settling before the window: NOT bookable
    // at B (destination unreceived, Q3-strict) — this is the rev.6 P0-1 pin.
    const relocates = leg({}) // A→B settles 08-03, before startAt
    expect(
      assessOneWayFeasibility({
        ...base,
        pendingLegs: [relocates],
        pickupLocationId: 'B',
        dropoffLocationId: 'B',
      }),
    ).toEqual({ ok: false, reason: 'PICKUP_NOT_AT_LOCATION' })
  })
  it('EXCLUDE (rule 3): a pending one-way makes the car unbookable at its origin for later windows', () => {
    const relocates = leg({}) // A→B settles before startAt — the car will be gone
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [relocates] })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
  })
  it('rule 3 benign case: earlier P→P round trips land back at P and do not exclude', () => {
    const roundTrip = leg({ toLocationId: 'A' })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [roundTrip] })).toEqual({ ok: true })
  })
  it('rule 4: a window overlapping a pending leg (e.g. a scheduled reposition) is rejected', () => {
    const repo = leg({
      kind: 'STAFF_REPOSITION',
      plannedStartAt: d('2026-09-02T00:00:00Z'),
      plannedEndAt: d('2026-09-04T00:00:00Z'),
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [repo] })).toEqual({
      ok: false,
      reason: 'WINDOW_OVERLAPS_MOVEMENT',
    })
  })
  it('rule precedence (rule 3 over rule 4): a projection-exclusion wins over a window overlap', () => {
    // Two live legs: the default A→B settles before startAt (rule 3 fires
    // first), AND a STAFF_REPOSITION overlaps the window (rule 4 would also
    // fire if reached). The reason is the user-facing diagnostic — rule 3
    // must outrank rule 4, so PICKUP_NOT_AT_LOCATION, not WINDOW_OVERLAPS_MOVEMENT.
    const relocates = leg({})
    const repo = leg({
      kind: 'STAFF_REPOSITION',
      plannedStartAt: d('2026-09-02T00:00:00Z'),
      plannedEndAt: d('2026-09-04T00:00:00Z'),
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [relocates, repo] })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
  })
  it('a dropoff outside the receiving set is rejected', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'X' })).toEqual({
      ok: false,
      reason: 'DROPOFF_NOT_HOMEWARD',
    })
  })
  it('TAIL (decision 15): a one-way inserted before a successor leg is rejected', () => {
    const successor = leg({
      fromLocationId: 'A',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-10T10:00:00Z'),
      plannedEndAt: d('2026-09-12T10:00:00Z'),
    })
    expect(
      assessOneWayFeasibility({ ...base, pendingLegs: [successor], dropoffLocationId: 'B' }),
    ).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })
  it('TAIL boundary: a successor starting the instant our window ends is still a successor (>=, not >)', () => {
    // Rule 4's window is half-open ([occupiedFrom, plannedEndAt) vs
    // [startAt, effectiveEndAt)) so a leg starting exactly at effectiveEndAt
    // does NOT overlap — it is left entirely to the tail rule. A `>` mutant
    // here would let this one-way through instead of rejecting it.
    const successor = leg({
      fromLocationId: 'A',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-03T10:00:00Z'), // == base.effectiveEndAt
      plannedEndAt: d('2026-09-05T10:00:00Z'),
    })
    expect(
      assessOneWayFeasibility({ ...base, pendingLegs: [successor], dropoffLocationId: 'B' }),
    ).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })
  it('a round trip BEFORE a successor stays feasible (car ends where it started)', () => {
    const successor = leg({
      fromLocationId: 'A',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-10T10:00:00Z'),
      plannedEndAt: d('2026-09-12T10:00:00Z'),
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [successor] })).toEqual({ ok: true })
  })
  it('an IN_TRANSIT car (null physical) is never bookable anywhere (Q3)', () => {
    expect(assessOneWayFeasibility({ ...base, physicalLocationId: null })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
  })
})
