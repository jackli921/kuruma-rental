import { OPERATOR_ROLES, SCOPE_BYPASS_ROLES } from '@kuruma/shared/auth/roles'

import type { AuthUser, UserRole } from './roles'

/** Caller identity extracted from JWT — required by every scoped repository method. */
export interface CallerContext {
  readonly userId: string
  readonly role: UserRole
  /** Tenant the caller is scoped to. Set for OPERATOR_* roles. */
  readonly operatorId?: string
  /** True only for PLATFORM_ADMIN + PARTNER (cross-tenant API caller). OPERATOR_* never bypass. */
  readonly bypassScope?: boolean
}

export function toCallerContext(user: AuthUser): CallerContext {
  const bypassScope = SCOPE_BYPASS_ROLES.has(user.role)
  // Only attach operatorId for tenant-scoped roles, and only when present
  // (exactOptionalPropertyTypes forbids an explicit `operatorId: undefined`).
  if (OPERATOR_ROLES.has(user.role) && user.operatorId !== undefined) {
    return { userId: user.id, role: user.role, operatorId: user.operatorId, bypassScope }
  }
  return { userId: user.id, role: user.role, bypassScope }
}

/** System-level context for internal queries that need full access (stats, fleet overview, availability). */
export const SYSTEM_CONTEXT: CallerContext = {
  userId: 'system',
  role: 'PLATFORM_ADMIN',
  bypassScope: true,
} as const

/**
 * Context for anonymous, public catalog reads (renter storefront). Renters
 * browse the cross-operator marketplace, so this resolves to an `all` operator
 * scope (operatorReadScope) — NOT a privilege bypass. Use it on unauthenticated
 * routes so scoped repos still receive a caller context (#395).
 */
export const PUBLIC_CONTEXT: CallerContext = {
  userId: 'public',
  role: 'RENTER',
  bypassScope: false,
} as const
