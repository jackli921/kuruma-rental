import { describe, expect, it } from 'vitest'
import { shouldShowBusinessSidebar } from './business-sidebar-visibility'

// A real business role (epic #385) and the renter role. Using literals keeps the
// truth table readable; both are members/non-members of the shared BUSINESS_ROLES set.
const OPERATOR = 'OPERATOR_OWNER'
const RENTER = 'RENTER'

describe('shouldShowBusinessSidebar', () => {
  it('shows the sidebar for a business user in business view who prefers the sidebar', () => {
    expect(shouldShowBusinessSidebar('sidebar', OPERATOR, undefined)).toBe(true)
  })

  it('hides the sidebar when the layout preference is topnav', () => {
    expect(shouldShowBusinessSidebar('topnav', OPERATOR, undefined)).toBe(false)
  })

  it('hides the sidebar for a business user viewing as a renter (P1: view decoupled from route)', () => {
    expect(shouldShowBusinessSidebar('sidebar', OPERATOR, 'renter')).toBe(false)
  })

  it('hides the sidebar for a non-business role even with the sidebar preference', () => {
    expect(shouldShowBusinessSidebar('sidebar', RENTER, undefined)).toBe(false)
  })

  it('hides the sidebar when the role is undefined (signed out)', () => {
    expect(shouldShowBusinessSidebar('sidebar', undefined, undefined)).toBe(false)
  })
})
