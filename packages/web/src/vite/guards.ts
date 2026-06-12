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

export function adminGuard(session: Session | null): GuardResult {
  if (!session) return { type: 'login' }
  // Narrower than businessGuard: tenant-scoped OPERATOR_* roles clear the business
  // gate but must NOT reach the cross-tenant /admin portal (#462 §2.3). Legacy
  // STAFF/ADMIN are still admitted (platform-roles.ts) until #487 revokes them.
  return isPlatformAdmin(session.user.role) ? { type: 'allow' } : { type: 'forbidden' }
}
