import type { UserRole } from '@kuruma/shared/auth/roles'
import { describe, expect, it } from 'vitest'
import { type RenterNavFlags, visibleRenterNavItems } from './renter-nav-items'

// The gate is a pure function now (#1322): the effective flags are injected, so the
// runtime-override wiring is proven at the component/route layer while this stays a
// fast, provider-free truth table. Beta default = both flags off.
const OFF: RenterNavFlags = { messaging: false, renterDocuments: false }
const tos = (role: UserRole | undefined, flags: RenterNavFlags = OFF): readonly string[] =>
  visibleRenterNavItems(role, flags).map((item) => item.to)

describe('visibleRenterNavItems', () => {
  it('shows a renter only My Bookings in beta (messaging + documents flags off)', () => {
    expect(tos('RENTER')).toEqual(['/$locale/bookings'])
  })

  it('shows the platform admin Messages but NOT My Bookings — bypass is visibility, My Bookings stays renter-only', () => {
    expect(tos('PLATFORM_ADMIN')).toEqual(['/$locale/messages'])
  })

  it('hides every renter item from an operator in renter view (not a renter, not the admin, flags off)', () => {
    expect(tos('OPERATOR_OWNER')).toEqual([])
  })

  it('hides every renter item from a signed-out viewer (undefined role)', () => {
    expect(tos(undefined)).toEqual([])
  })

  it('shows a renter Messages once the messaging flag is on', () => {
    expect(tos('RENTER', { messaging: true, renterDocuments: false })).toEqual([
      '/$locale/bookings',
      '/$locale/messages',
    ])
  })

  it('shows a renter Documents once the documents flag is on (gated on the real renter role)', () => {
    expect(tos('RENTER', { messaging: false, renterDocuments: true })).toEqual([
      '/$locale/bookings',
      '/$locale/documents',
    ])
  })

  it('keeps Documents hidden from the admin even with the flag on — no bypass, it is renter-only "my data" (Messages still shows via bypass)', () => {
    expect(tos('PLATFORM_ADMIN', { messaging: false, renterDocuments: true })).toEqual([
      '/$locale/messages',
    ])
  })
})
