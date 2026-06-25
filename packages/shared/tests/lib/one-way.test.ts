import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  type MovementLeg,
  ONE_WAY_REASONS,
  assessPickupFeasibility,
  findStrandedSuccessors,
  locationAt,
  toMovementLegs,
} from '../../src/lib/one-way'

// All times are plain UTC instants; turnaround is already folded into
// `effectiveEndAt` (the car is "settled" at the dropoff from then on).
const at = (iso: string): Date => new Date(`2026-06-${iso}:00:00Z`)
const A = 'loc-a'
const B = 'loc-b'
const C = 'loc-c'

// A movement leg: car picked up at `pickup` at `startAt`, settled at `dropoff`
// from `effectiveEndAt` onward. Helper keeps the timelines readable. By
// construction these are movement legs (no CANCELLED in the literal tests);
// the cast threads them through the brand without changing runtime behavior.
const leg = (pickup: string, dropoff: string, start: string, effEnd: string): MovementLeg =>
  ({
    pickupLocationId: pickup,
    dropoffLocationId: dropoff,
    startAt: at(start),
    effectiveEndAt: at(effEnd),
  }) as MovementLeg

describe('locationAt', () => {
  it('empty history → the home location', () => {
    expect(locationAt([], A, at('15T10'))).toBe(A)
  })

  it('home may be null (no home, no movement) → null', () => {
    expect(locationAt([], null, at('15T10'))).toBeNull()
  })

  it('a COMPLETED A→B leg puts the car at B AFTER its effectiveEnd (regression: completed trip does not snap home)', () => {
    // The caller pre-filters to movement history, which INCLUDES COMPLETED.
    const legs = [leg(A, B, '20T10', '22T10')]
    expect(locationAt(legs, A, at('23T10'))).toBe(B) // after effEnd → at B
  })

  it('before the leg settles, the car is still home', () => {
    const legs = [leg(A, B, '20T10', '22T10')]
    expect(locationAt(legs, A, at('21T10'))).toBe(A) // effEnd 22 > 21 → not yet moved
  })

  it('exactly at effectiveEnd the car has settled at the dropoff ([..eff] inclusive)', () => {
    const legs = [leg(A, B, '20T10', '22T10')]
    expect(locationAt(legs, A, at('22T10'))).toBe(B) // effEnd <= t
  })

  it('the leg with the GREATEST effectiveEnd ≤ t wins', () => {
    const legs = [leg(A, B, '20T10', '22T10'), leg(B, C, '23T10', '24T10')]
    expect(locationAt(legs, A, at('25T10'))).toBe(C) // C is the latest settle
    expect(locationAt(legs, A, at('22T20'))).toBe(B) // only the A→B leg has settled by then
  })

  it('CANCELLED legs are the caller’s job to exclude — a leg present in the array is counted', () => {
    // This module trusts the caller filtered out CANCELLED; included legs move the car.
    const legs = [leg(A, B, '20T10', '22T10')]
    expect(locationAt(legs, A, at('23T10'))).toBe(B)
  })
})

describe('assessPickupFeasibility', () => {
  const base = {
    homeLocationId: A as string | null,
    policy: DEFAULT_POLICY,
  }

  it('round trip at the car’s current location → ok', () => {
    const res = assessPickupFeasibility({
      ...base,
      legs: [],
      pickup: A,
      dropoff: A,
      startAt: at('15T10'),
      effectiveEndAt: at('16T10'),
    })
    expect(res).toEqual({ ok: true })
  })

  it('pickup ≠ where the car actually is → PICKUP_NOT_AT_LOCATION', () => {
    // Car moved A→B and settled; a new pickup at A is impossible.
    const legs = [leg(A, B, '20T10', '22T10')]
    const res = assessPickupFeasibility({
      ...base,
      legs,
      pickup: A,
      dropoff: A,
      startAt: at('25T10'),
      effectiveEndAt: at('26T10'),
    })
    expect(res).toEqual({ ok: false, reason: 'PICKUP_NOT_AT_LOCATION' })
  })

  it('one-way as the tail (no later booking) → ok', () => {
    const res = assessPickupFeasibility({
      ...base,
      legs: [],
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
    })
    expect(res).toEqual({ ok: true })
  })

  it('one-way with a later booking → ONEWAY_NOT_TAIL (TAIL_ONLY)', () => {
    // A later leg starts after the new booking ends → the one-way is not the tail.
    const legs = [leg(A, A, '25T10', '26T10')]
    const res = assessPickupFeasibility({
      ...base,
      legs,
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
    })
    expect(res).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })

  it('boundary: a successor starting exactly at effectiveEnd still counts as a successor → ONEWAY_NOT_TAIL', () => {
    const legs = [leg(A, A, '22T10', '23T10')] // starts at the new booking's effEnd
    const res = assessPickupFeasibility({
      ...base,
      legs,
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
    })
    expect(res).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })

  it('FULL_CHAIN: a successor that picks up at the dropoff → ok (handoff continuous)', () => {
    const legs = [leg(B, C, '25T10', '26T10')] // successor picks up at B = our dropoff
    const res = assessPickupFeasibility({
      legs,
      homeLocationId: A,
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
      policy: 'FULL_CHAIN',
    })
    expect(res).toEqual({ ok: true })
  })

  it('FULL_CHAIN: a successor that picks up elsewhere → DROPOFF_DISCONTINUITY', () => {
    const legs = [leg(C, A, '25T10', '26T10')] // successor picks up at C ≠ our dropoff B
    const res = assessPickupFeasibility({
      legs,
      homeLocationId: A,
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
      policy: 'FULL_CHAIN',
    })
    expect(res).toEqual({ ok: false, reason: 'DROPOFF_DISCONTINUITY' })
  })

  it('TAIL_ONLY short-circuits before R3: a discontinuous successor still yields ONEWAY_NOT_TAIL', () => {
    // Successor picks up at C (≠ our dropoff B). Under FULL_CHAIN this is
    // DROPOFF_DISCONTINUITY; under tail-only the tail guard fires first, so the
    // reason must be ONEWAY_NOT_TAIL — locks the check ordering against a refactor.
    const legs = [leg(C, A, '25T10', '26T10')]
    const res = assessPickupFeasibility({
      ...base, // policy = DEFAULT_POLICY = TAIL_ONLY
      legs,
      pickup: A,
      dropoff: B,
      startAt: at('20T10'),
      effectiveEndAt: at('22T10'),
    })
    expect(res).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })

  it('DEFAULT_POLICY is tail-only', () => {
    expect(DEFAULT_POLICY).toBe('TAIL_ONLY')
  })
})

describe('findStrandedSuccessors', () => {
  it('a successor that picked up at the cancelled leg’s dropoff is stranded', () => {
    // A→B (cancelled) left the car at B; B→C relied on that. Remove A→B and the
    // car is back home at A, so B→C can no longer pick up at B.
    const cancelled = leg(A, B, '20T10', '22T10')
    const dependent = leg(B, C, '25T10', '26T10')
    expect(findStrandedSuccessors([cancelled, dependent], A, cancelled)).toEqual([dependent])
  })

  it('strands every successor that relied on the cancelled relocation', () => {
    // A→B (cancelled) put the car at B; both B→A and B→C picked up at B. Remove
    // A→B and neither finds the car at B — both are stranded. (Single-removal
    // semantics: each remaining leg still folds in, but neither re-establishes B.)
    const cancelled = leg(A, B, '20T10', '22T10')
    const dep1 = leg(B, A, '24T10', '25T10')
    const dep2 = leg(B, C, '26T10', '27T10')
    expect(findStrandedSuccessors([cancelled, dep1, dep2], A, cancelled)).toEqual([dep1, dep2])
  })

  it('an independent successor (picks up where the car still is) is not stranded', () => {
    // A→A round trip cancelled; a later A→C still finds the car at home A.
    const cancelled = leg(A, A, '20T10', '22T10')
    const independent = leg(A, C, '25T10', '26T10')
    expect(findStrandedSuccessors([cancelled, independent], A, cancelled)).toEqual([])
  })

  it('legs before the cancelled leg are never stranded', () => {
    const earlier = leg(A, A, '10T10', '11T10')
    const cancelled = leg(A, B, '20T10', '22T10')
    expect(findStrandedSuccessors([earlier, cancelled], A, cancelled)).toEqual([])
  })
})

// The brand exists to make "filter CANCELLED" unforgettable: pre-#1040 callers
// loading raw DB rows would silently feed CANCELLED legs into locationAt and
// get the wrong location. toMovementLegs is the single allowed constructor.
describe('toMovementLegs', () => {
  it('drops CANCELLED rows and keeps everything else', () => {
    const rows = [
      { ...leg(A, B, '15T10', '16T10'), status: 'CONFIRMED' },
      { ...leg(B, A, '17T10', '18T10'), status: 'CANCELLED' },
      { ...leg(A, C, '20T10', '21T10'), status: 'COMPLETED' },
      { ...leg(C, A, '22T10', '23T10'), status: 'ACTIVE' },
    ]
    const moves = toMovementLegs(rows)
    expect(moves).toHaveLength(3)
    expect(moves.map((m) => m.dropoffLocationId)).toEqual([B, C, A])
  })

  it('does not retain extra status field on the branded leg', () => {
    const [m] = toMovementLegs([{ ...leg(A, B, '15T10', '16T10'), status: 'CONFIRMED' }])
    expect(m).toBeDefined()
    expect((m as unknown as { status?: string }).status).toBeUndefined()
  })
})

describe('ONE_WAY_REASONS', () => {
  // The SSoT: routes that map reason→error code, future i18n tables, telemetry
  // labels all derive coverage from this tuple — a rename here is a compile
  // error there, not a silent prod break.
  it('matches the Feasibility reason union exhaustively', () => {
    // Any rename of a string would compile-error this map; that's the point.
    const expectedKeys: Record<(typeof ONE_WAY_REASONS)[number], true> = {
      PICKUP_NOT_AT_LOCATION: true,
      ONEWAY_NOT_TAIL: true,
      DROPOFF_DISCONTINUITY: true,
    }
    for (const r of ONE_WAY_REASONS) expect(expectedKeys[r]).toBe(true)
    expect(Object.keys(expectedKeys).sort()).toEqual([...ONE_WAY_REASONS].sort())
  })
})
