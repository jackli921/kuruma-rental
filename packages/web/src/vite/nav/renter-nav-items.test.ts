import type { UserRole } from '@kuruma/shared/auth/roles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { visibleRenterNavItems } from './renter-nav-items'

// `to` literals in render order, for compact truth-table assertions.
const tos = (role: UserRole | undefined): readonly string[] =>
  visibleRenterNavItems(role).map((item) => item.to)

afterEach(() => {
  vi.unstubAllEnvs()
})

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
    vi.stubEnv('VITE_FEATURE_MESSAGING', 'true')
    expect(tos('RENTER')).toEqual(['/$locale/bookings', '/$locale/messages'])
  })
})
