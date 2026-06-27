import { describe, expect, it } from 'vitest'
import type { CallerContext } from './middleware/auth'
import { bookingReadScope, vehicleBlockReadScope } from './tenancy'

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
})
