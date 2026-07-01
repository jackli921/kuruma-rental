import { describe, expect, it } from 'vitest'
import type { CallerContext } from './middleware/auth'
import {
  bookingReadScope,
  narrowReadToOperator,
  operatorReadScope,
  threadReadScope,
  vehicleBlockReadScope,
} from './tenancy'

describe('bookingReadScope', () => {
  it('scopes a PARTNER to its own channel (source=TRIP_COM), not all bookings', () => {
    // #1119: a Trip.com PARTNER key must NOT read operators' DIRECT bookings.
    const partner: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }
    expect(bookingReadScope(partner)).toEqual({ kind: 'partner', source: 'TRIP_COM' })
  })

  it('keeps PLATFORM_ADMIN unscoped (sees all bookings)', () => {
    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    expect(bookingReadScope(admin)).toEqual({ kind: 'all' })
  })

  it('scopes an OPERATOR_OWNER to its tenant', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-1' }
    expect(bookingReadScope(op)).toEqual({ kind: 'operator', operatorId: 'op-1' })
  })

  it('fails closed for an operator missing its operatorId', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_STAFF' }
    expect(bookingReadScope(op)).toEqual({ kind: 'none' })
  })

  it('scopes a RENTER to their own bookings', () => {
    const renter: CallerContext = { userId: 'r1', role: 'RENTER' }
    expect(bookingReadScope(renter)).toEqual({ kind: 'renter', renterId: 'r1' })
  })
})

describe('vehicleBlockReadScope', () => {
  it('returns all for a bypass caller (PLATFORM_ADMIN)', () => {
    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    expect(vehicleBlockReadScope(admin)).toEqual({ kind: 'all' })
  })

  it('returns operator for an OPERATOR_* caller with operatorId', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-1' }
    expect(vehicleBlockReadScope(op)).toEqual({ kind: 'operator', operatorId: 'op-1' })
  })

  it('returns none for an OPERATOR_* caller missing operatorId (fail-closed)', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_STAFF' }
    expect(vehicleBlockReadScope(op)).toEqual({ kind: 'none' })
  })

  it('returns none for an in-gate non-bypass non-operator (legacy STAFF/ADMIN)', () => {
    const staff: CallerContext = { userId: 's1', role: 'STAFF', bypassScope: false }
    const admin: CallerContext = { userId: 'a1', role: 'ADMIN', bypassScope: false }
    expect(vehicleBlockReadScope(staff)).toEqual({ kind: 'none' })
    expect(vehicleBlockReadScope(admin)).toEqual({ kind: 'none' })
  })

  it('returns none for a PARTNER despite its bypassScope (fail-closed before bypass)', () => {
    // A Trip.com PARTNER key carries bypassScope=true via SCOPE_BYPASS_ROLES; a
    // bypass-first resolver would leak every operator's blocks to the channel.
    const partner: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }
    expect(vehicleBlockReadScope(partner)).toEqual({ kind: 'none' })
  })
})

describe('narrowReadToOperator', () => {
  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  const operator: CallerContext = { userId: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-self' }

  it('narrows an all-scope caller to the requested operator (bookingReadScope)', () => {
    expect(narrowReadToOperator(admin, 'op-target', bookingReadScope)).toBe('op-target')
  })

  it('returns undefined for an all-scope caller who requests no operator (aggregate)', () => {
    expect(narrowReadToOperator(admin, undefined, bookingReadScope)).toBeUndefined()
  })

  it('drops a requested operatorId for a tenant-scoped caller (never widens across tenants)', () => {
    // The H2 invariant: a foreign operatorId param must not let an OPERATOR_*
    // caller read another tenant. Their own scope still applies at the repo.
    expect(narrowReadToOperator(operator, 'op-other', bookingReadScope)).toBeUndefined()
    expect(narrowReadToOperator(operator, 'op-self', bookingReadScope)).toBeUndefined()
  })

  it('returns undefined for an operator missing its operatorId (fail-closed)', () => {
    const noOp: CallerContext = { userId: 'u2', role: 'OPERATOR_STAFF' }
    expect(narrowReadToOperator(noOp, 'op-target', bookingReadScope)).toBeUndefined()
  })

  it('DROPS a renter requested id under bookingReadScope (private-read vocabulary)', () => {
    // #1272: the helper no longer echoes non-bypass ids. bookingReadScope maps a
    // renter to `renter` (not `all`), so the requested id drops here — closing the
    // trap where a future bookingReadScope-private consumer reused this helper and
    // silently leaked a renter's `?operatorId=` across tenants.
    const renter: CallerContext = { userId: 'r1', role: 'RENTER' }
    expect(narrowReadToOperator(renter, 'op-target', bookingReadScope)).toBeUndefined()
  })

  it('DROPS a PARTNER channel requested id under bookingReadScope', () => {
    // A Trip.com PARTNER key carries bypassScope=true; bookingReadScope maps it to
    // `partner` (its own sourced bookings), NOT `all`, so the id drops.
    const partner: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }
    expect(narrowReadToOperator(partner, 'op-target', bookingReadScope)).toBeUndefined()
  })

  it('DROPS legacy STAFF/ADMIN requested ids under bookingReadScope', () => {
    // #487 removed legacy STAFF/ADMIN from the bypass set; bookingReadScope maps
    // them to `renter`, so their requested id drops (parity with the overview repo,
    // which already reads nothing for them).
    const staff: CallerContext = { userId: 's1', role: 'STAFF', bypassScope: false }
    const legacyAdmin: CallerContext = { userId: 'a1', role: 'ADMIN', bypassScope: false }
    expect(narrowReadToOperator(staff, 'op-target', bookingReadScope)).toBeUndefined()
    expect(narrowReadToOperator(legacyAdmin, 'op-target', bookingReadScope)).toBeUndefined()
  })

  it('HONORS the same renter id under operatorReadScope — the resolver picks the vocabulary', () => {
    // The behavior is not hard-coded to one scope: passing the catalog vocabulary
    // (operatorReadScope maps a renter to `all`) makes the id pass through. Callers
    // choose the resolver that matches their read's privacy model; the aggregate
    // reads pass bookingReadScope precisely so renter/partner ids drop.
    const renter: CallerContext = { userId: 'r1', role: 'RENTER' }
    expect(narrowReadToOperator(renter, 'op-target', operatorReadScope)).toBe('op-target')
  })
})

describe('threadReadScope', () => {
  it('keeps PLATFORM_ADMIN unscoped (sees all threads)', () => {
    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    expect(threadReadScope(admin)).toEqual({ kind: 'all' })
  })

  it('scopes an OPERATOR_OWNER to its tenant', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-1' }
    expect(threadReadScope(op)).toEqual({ kind: 'operator', operatorId: 'op-1' })
  })

  it('scopes an OPERATOR_STAFF to its tenant', () => {
    const op: CallerContext = { userId: 'u2', role: 'OPERATOR_STAFF', operatorId: 'op-2' }
    expect(threadReadScope(op)).toEqual({ kind: 'operator', operatorId: 'op-2' })
  })

  it('fails closed for an operator missing its operatorId', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_STAFF' }
    expect(threadReadScope(op)).toEqual({ kind: 'none' })
  })

  it('scopes a RENTER to threads they participate in', () => {
    const renter: CallerContext = { userId: 'r1', role: 'RENTER' }
    expect(threadReadScope(renter)).toEqual({ kind: 'participant', userId: 'r1' })
  })

  it('scopes a PARTNER to participant-membership, NOT all threads (#1168 regression)', () => {
    // PARTNER carries bypassScope=true for bookings/user-search, but threads are
    // private: gating `all` on bypassScope (not PRIVILEGED_ROLES) would re-open
    // the cross-tenant thread leak #1168 closed. A PARTNER participates in no
    // threads, so membership-scoping yields nothing.
    const partner: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }
    expect(threadReadScope(partner)).toEqual({ kind: 'participant', userId: 'trip-com' })
  })
})
