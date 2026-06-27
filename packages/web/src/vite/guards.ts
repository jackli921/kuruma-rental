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

// A *tenant-scoped* operator session carries an operatorId (#521); bypass business
// roles (PLATFORM_ADMIN) do not. This mirrors the API's read scope
// (`operatorReadScope(ctx).kind !== 'all'`) and gates the operator-portal write
// affordances (Add/Edit/Archive) because those forms carry no operator picker: a write
// needs a single target tenant, which only an operator session supplies. It is
// deliberately STRICTER than the API write resolver, which also admits a bypass role
// that supplies an explicit operatorId — so do NOT reuse this to gate a future surface
// that lets an admin pick a tenant. Bypass roles still read cross-operator (#387
// oversight), so the page renders read-only for them (#529/#583/#598 review).
export function isOperatorSession(session: Session | null): boolean {
  return Boolean(session?.user.operatorId)
}

// Owner-tier session — gates the renter-facing `preAuthHandoffUrl` field in the
// settings UI (#903), mirroring the API's OPERATOR_OWNER_WRITE_ROLES gate. Only an
// operator OWNER may edit that money-flow control; OPERATOR_STAFF sees it disabled.
// Bypass roles never reach a writable settings page (they carry no operatorId, so
// `isOperatorSession` is already false). UX only — the API is the real boundary.
export function isOperatorOwnerSession(session: Session | null): boolean {
  return session?.user.role === 'OPERATOR_OWNER'
}

export function adminGuard(session: Session | null): GuardResult {
  if (!session) return { type: 'login' }
  // Narrower than businessGuard: tenant-scoped OPERATOR_* roles clear the business
  // gate but must NOT reach the cross-tenant /admin portal (#462 §2.3). Legacy
  // STAFF/ADMIN were revoked from platform access in #487 (platform-roles.ts).
  return isPlatformAdmin(session.user.role) ? { type: 'allow' } : { type: 'forbidden' }
}
