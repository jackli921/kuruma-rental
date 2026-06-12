import { isBusinessRole } from '@/lib/business-roles'
import { isPlatformAdmin } from '@/lib/platform-roles'
import type { Session } from './session'

// Pure access decision (FC/IS) — the route's beforeLoad turns it into a typed
// redirect. API enforcement is the real boundary; these guards are UX only (§4.3).
export type GuardResult = { type: 'allow' } | { type: 'login' } | { type: 'forbidden' }

export function renterGuard(session: Session | null): GuardResult {
  return session ? { type: 'allow' } : { type: 'login' }
}

export function businessGuard(session: Session | null): GuardResult {
  if (!session) return { type: 'login' }
  // Silent redirect for wrong role (razor line 122).
  return isBusinessRole(session.user.role) ? { type: 'allow' } : { type: 'forbidden' }
}

// `/manage/$operatorSlug` access (#521 §8). A business role is necessary but not
// sufficient: the caller may only enter their OWN operator's space, so the
// session slug must equal the URL slug. Fail-closed — a business role with no
// slug (PLATFORM_ADMIN/legacy STAFF use the admin portal) is forbidden, never
// allowed through. The API is the real boundary; this is UX routing only.
export function manageGuard(session: Session | null, operatorSlug: string): GuardResult {
  const business = businessGuard(session)
  if (business.type !== 'allow') return business
  return session?.user.operatorSlug === operatorSlug ? { type: 'allow' } : { type: 'forbidden' }
}

export function adminGuard(session: Session | null): GuardResult {
  if (!session) return { type: 'login' }
  // Narrower than businessGuard: tenant-scoped OPERATOR_* roles clear the business
  // gate but must NOT reach the cross-tenant /admin portal (#462 §2.3). Legacy
  // STAFF/ADMIN are still admitted (platform-roles.ts) until #487 revokes them.
  return isPlatformAdmin(session.user.role) ? { type: 'allow' } : { type: 'forbidden' }
}
