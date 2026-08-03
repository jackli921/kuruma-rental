import { describe, expect, it } from 'vitest'
import {
  type PendingLeg,
  allowedDropoffIds,
  ownerActiveLocationIds,
  pendingLegOverlaps,
  projectedLocationAt,
} from './custody-timeline'

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

describe('projectedLocationAt (§8 rule 3 building block)', () => {
  it('no pending legs → the car stays where it physically is', () => {
    expect(projectedLocationAt('A', [], d('2026-09-01T00:00:00Z'))).toBe('A')
  })
  it('a settled projection relocates the car from its plannedEndAt onward', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-03T10:00:00Z'))).toBe('B')
  })
  it('before the projection settles, the car is still at its current location', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-01T09:00:00Z'))).toBe('A')
  })
  it('the LATEST settled projection wins (P→P chains land back at P)', () => {
    const rt1 = leg({ toLocationId: 'A' })
    const rt2 = leg({
      toLocationId: 'A',
      plannedStartAt: d('2026-08-05T10:00:00Z'),
      plannedEndAt: d('2026-08-06T10:00:00Z'),
    })
    expect(projectedLocationAt('A', [rt1, rt2], d('2026-08-07T00:00:00Z'))).toBe('A')
  })
  it('an IN_TRANSIT car (null current) is nowhere until received', () => {
    const inFlight = leg({ departedAt: d('2026-08-01T10:00:00Z') })
    expect(projectedLocationAt(null, [inFlight], d('2026-08-02T00:00:00Z'))).toBe(null)
  })
})

describe('pendingLegOverlaps (§8 rule 4, generalized to non-booking legs)', () => {
  it('a planned window overlapping the requested window is an overlap', () => {
    expect(
      pendingLegOverlaps([leg({})], d('2026-08-02T00:00:00Z'), d('2026-08-04T00:00:00Z')),
    ).toBe(true)
  })
  it('[closed, open) — windows that only touch do not overlap', () => {
    expect(
      pendingLegOverlaps([leg({})], d('2026-08-03T10:00:00Z'), d('2026-08-05T00:00:00Z')),
    ).toBe(false)
    expect(
      pendingLegOverlaps([leg({})], d('2026-07-30T00:00:00Z'), d('2026-08-01T10:00:00Z')),
    ).toBe(false)
  })
  it('an in-flight leg occupies from its ACTUAL departure', () => {
    const early = leg({ departedAt: d('2026-08-01T08:00:00Z') })
    expect(pendingLegOverlaps([early], d('2026-08-01T08:30:00Z'), d('2026-08-01T09:00:00Z'))).toBe(
      true,
    )
  })
})

describe('ownerActiveLocationIds (§7 building block)', () => {
  const locations = [
    { id: 'L1', operatorId: 'owner', status: 'ACTIVE' },
    { id: 'L2', operatorId: 'owner', status: 'ARCHIVED' },
    { id: 'L3', operatorId: 'other', status: 'ACTIVE' },
  ]
  it('active owner locations only', () => {
    expect(
      ownerActiveLocationIds({ ownerOperatorId: 'owner', ownerDeactivatedAt: null, locations }),
    ).toEqual(new Set(['L1']))
  })
  it('a deactivated owner has an empty set', () => {
    expect(
      ownerActiveLocationIds({
        ownerOperatorId: 'owner',
        ownerDeactivatedAt: d('2026-01-01T00:00:00Z'),
        locations,
      }),
    ).toEqual(new Set())
  })
})

describe('allowedDropoffIds (§7 rev.7 — receiving set split from owner set)', () => {
  const ownerActive = new Set(['HOME', 'B', 'C'])
  // Slice 1 (no host opt-in yet): receiving == ownerActive. The FOREIGN host
  // cases below pin the Slice-2 semantics the function must already carry.
  const receiving = new Set(['HOME', 'B', 'C', 'F'])
  it('at home: the whole receiving set (the one permitted hop out, incl. a foreign F)', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'HOME',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'B', 'C', 'F']))
  })
  it('displaced at owner branch B: return home or a round trip in place — never onward B→C', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'B']))
  })
  it('displaced at FOREIGN F: home comes from the owner set, P→P from the receiving set', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'F',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'F']))
  })
  it('displaced with an archived home: only the round trip in place remains', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: new Set(['B', 'C']),
        receivingLocationIds: new Set(['B', 'C']),
      }),
    ).toEqual(new Set(['B']))
  })
  it('no home base assigned: round trip in place only', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: null,
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['B']))
  })
})
