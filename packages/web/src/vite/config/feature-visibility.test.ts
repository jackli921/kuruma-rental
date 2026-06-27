import type { UserRole } from '@kuruma/shared/auth/roles'
import { describe, expect, it } from 'vitest'
import { isVisibleToViewer } from './feature-visibility'

// Truth table for the admin-bypass visibility rule (design §4): a post-MVP feature
// is hidden in beta (flag OFF) but always visible to the platform admin so the
// owner can preview it on the live site. Roles are real members/non-members of the
// shared PLATFORM_ROLES set; literals keep the table readable.
const RENTER: UserRole = 'RENTER'
const PLATFORM_ADMIN: UserRole = 'PLATFORM_ADMIN'
const OPERATOR: UserRole = 'OPERATOR_OWNER'

describe('isVisibleToViewer', () => {
  it('hides a flagged-off feature from a renter', () => {
    expect(isVisibleToViewer(false, RENTER)).toBe(false)
  })

  it('shows a flagged-off feature to the platform admin (owner preview bypass)', () => {
    expect(isVisibleToViewer(false, PLATFORM_ADMIN)).toBe(true)
  })

  it('hides a flagged-off feature from an operator (bypass is platform-admin only)', () => {
    expect(isVisibleToViewer(false, OPERATOR)).toBe(false)
  })

  it('hides a flagged-off feature from a signed-out viewer (undefined role)', () => {
    expect(isVisibleToViewer(false, undefined)).toBe(false)
  })

  it('shows a flagged-on feature to everyone, including a renter', () => {
    expect(isVisibleToViewer(true, RENTER)).toBe(true)
  })
})
