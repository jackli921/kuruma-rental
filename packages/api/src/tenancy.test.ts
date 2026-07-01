import { describe, expect, it } from 'vitest'
import type { CallerContext } from './middleware/auth'
import { bookingReadScope, narrowReadToOperator, vehicleBlockReadScope } from './tenancy'

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

  it('narrows an all-scope caller to the requested operator', () => {
    expect(narrowReadToOperator(admin, 'op-target')).toBe('op-target')
  })

  it('returns undefined for an all-scope caller who requests no operator (aggregate)', () => {
    expect(narrowReadToOperator(admin, undefined)).toBeUndefined()
  })

  it('ignores a requested operatorId for a tenant-scoped caller (never widens across tenants)', () => {
    // The H2 invariant: a foreign operatorId param must not let an OPERATOR_*
    // caller read another tenant. Their own scope still applies at the repo.
    expect(narrowReadToOperator(operator, 'op-other')).toBeUndefined()
    expect(narrowReadToOperator(operator, 'op-self')).toBeUndefined()
  })

  it('returns undefined for an operator missing its operatorId (fail-closed)', () => {
    const noOp: CallerContext = { userId: 'u2', role: 'OPERATOR_STAFF' }
    expect(narrowReadToOperator(noOp, 'op-target')).toBeUndefined()
  })
})
