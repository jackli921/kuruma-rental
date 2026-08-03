import { describe, expect, it } from 'vitest'
import {
  type CustodySnapshot,
  departCustody,
  isAtHome,
  isCustodyListable,
  isHostOwner,
  placeCustody,
  receiveCustody,
} from './custody-state'

const atStation: CustodySnapshot = {
  custodyState: 'AT_STATION',
  physicalHostOperatorId: 'op-a',
  physicalLocationId: 'loc-1',
}
const inTransit: CustodySnapshot = {
  custodyState: 'IN_TRANSIT',
  physicalHostOperatorId: null,
  physicalLocationId: null,
}
const untracked: CustodySnapshot = {
  custodyState: null,
  physicalHostOperatorId: null,
  physicalLocationId: null,
}

describe('departCustody', () => {
  it('AT_STATION departs to IN_TRANSIT with both ids nulled', () => {
    expect(departCustody(atStation)).toEqual({ ok: true, next: inTransit })
  })
  it('rejects departure while IN_TRANSIT', () => {
    expect(departCustody(inTransit)).toEqual({ ok: false, reason: 'NOT_AT_STATION' })
  })
  it('rejects departure while untracked', () => {
    expect(departCustody(untracked)).toEqual({ ok: false, reason: 'NOT_AT_STATION' })
  })
})

describe('receiveCustody', () => {
  it('IN_TRANSIT is received AT_STATION at the given host + location', () => {
    expect(receiveCustody(inTransit, 'op-b', 'loc-9')).toEqual({
      ok: true,
      next: {
        custodyState: 'AT_STATION',
        physicalHostOperatorId: 'op-b',
        physicalLocationId: 'loc-9',
      },
    })
  })
  it('rejects a receipt while AT_STATION (double-receipt)', () => {
    expect(receiveCustody(atStation, 'op-b', 'loc-9')).toEqual({
      ok: false,
      reason: 'NOT_IN_TRANSIT',
    })
  })
})

describe('placeCustody', () => {
  it('places an untracked vehicle AT_STATION at its owner + home', () => {
    expect(placeCustody(untracked, 'op-a', 'loc-1')).toEqual({ ok: true, next: atStation })
  })
  it('rejects placing an already-tracked vehicle', () => {
    expect(placeCustody(atStation, 'op-a', 'loc-2')).toEqual({
      ok: false,
      reason: 'ALREADY_PLACED',
    })
    expect(placeCustody(inTransit, 'op-a', 'loc-2')).toEqual({
      ok: false,
      reason: 'ALREADY_PLACED',
    })
  })
})

describe('derived facts (§3 — derived, never stored)', () => {
  it('isAtHome compares physical location to home base', () => {
    expect(isAtHome(atStation, 'loc-1')).toBe(true)
    expect(isAtHome(atStation, 'loc-2')).toBe(false)
    expect(isAtHome(inTransit, 'loc-1')).toBe(false)
    expect(isAtHome(atStation, null)).toBe(false)
  })
  it('isHostOwner compares physical host to owner', () => {
    expect(isHostOwner(atStation, 'op-a')).toBe(true)
    expect(isHostOwner(atStation, 'op-b')).toBe(false)
    expect(isHostOwner(inTransit, 'op-a')).toBe(false)
  })
})

describe('isCustodyListable (§8 rule 1 — the presence conditions)', () => {
  it('AT_STATION + AVAILABLE + not held offline is listable', () => {
    expect(
      isCustodyListable({ status: 'AVAILABLE', custodyState: 'AT_STATION', heldOffline: false }),
    ).toBe(true)
  })
  it('IN_TRANSIT is always off (Q3)', () => {
    expect(
      isCustodyListable({ status: 'AVAILABLE', custodyState: 'IN_TRANSIT', heldOffline: false }),
    ).toBe(false)
  })
  it('heldOffline suppresses listing', () => {
    expect(
      isCustodyListable({ status: 'AVAILABLE', custodyState: 'AT_STATION', heldOffline: true }),
    ).toBe(false)
  })
  it('untracked (legacy/unassigned) stays listable — flag-off equivalence', () => {
    expect(isCustodyListable({ status: 'AVAILABLE', custodyState: null, heldOffline: false })).toBe(
      true,
    )
  })
  it('owner status gates regardless of custody', () => {
    expect(
      isCustodyListable({ status: 'MAINTENANCE', custodyState: 'AT_STATION', heldOffline: false }),
    ).toBe(false)
  })
})
