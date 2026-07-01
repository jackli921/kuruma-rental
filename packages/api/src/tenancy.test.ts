import { describe, expect, it } from 'vitest'
import type { CallerContext } from './middleware/auth'
import { bookingReadScope, threadReadScope, vehicleBlockReadScope } from './tenancy'

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
