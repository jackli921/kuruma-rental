import { isPlatformAdmin } from '@/lib/platform-roles'

const LOCALES = new Set(['en', 'ja', 'zh'])
const DEFAULT_LOCALE = 'en'

const RENTER_PATHS = ['/bookings', '/messages']
const BUSINESS_PATHS = ['/dashboard', '/manage/']
const ADMIN_PREFIX = '/admin'

type RouteClassification =
  | { type: 'public' }
  | { type: 'renter' }
  | { type: 'business' }
  | { type: 'admin' }

export function stripLocale(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (maybeLocale && LOCALES.has(maybeLocale)) {
    const rest = segments.slice(2).join('/')
    return rest ? `/${rest}` : '/'
  }
  return pathname
}

export function getLocaleFromPath(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (maybeLocale && LOCALES.has(maybeLocale)) {
    return maybeLocale
  }
  return DEFAULT_LOCALE
}

export function classifyRoute(path: string): RouteClassification {
  // Segment-aware so `/administration` / `/admin-help` are NOT gated as admin
  // (#481 review P3): only the exact `/admin` or a real `/admin/...` subpath.
  if (path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`)) {
    return { type: 'admin' }
  }
  if (BUSINESS_PATHS.some((p) => path.startsWith(p))) {
    return { type: 'business' }
  }
  if (RENTER_PATHS.some((p) => path.startsWith(p))) {
    return { type: 'renter' }
  }
  return { type: 'public' }
}

type AdminAccessDecision = { action: 'login' | 'forbidden' | 'allow' }

/**
 * Pure authz decision for `/admin` routes. Keeps the middleware (an I/O shell)
 * thin and the rule unit-testable (FC/IS): `null` role (unauthenticated) -> send
 * to login; an authenticated non-platform-admin -> forbidden; a platform admin ->
 * allow. The redirect I/O itself stays in `middleware.ts`.
 */
export function decideAdminAccess(role: string | null): AdminAccessDecision {
  if (role === null) {
    return { action: 'login' }
  }
  if (!isPlatformAdmin(role)) {
    return { action: 'forbidden' }
  }
  return { action: 'allow' }
}

/**
 * Safely extract the role from an auth session. Returns `null` when the session
 * is missing, has no `user` (can happen on CF Workers when auth fails silently),
 * or has no `role` field. Never throws.
 */
export function extractSessionRole(
  session: { user?: { role?: unknown } | null } | null | undefined,
): string | null {
  const role = session?.user?.role
  return typeof role === 'string' && role.length > 0 ? role : null
}
