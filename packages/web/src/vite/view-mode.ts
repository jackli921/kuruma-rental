import { isBusinessRole } from '@/lib/business-roles'

export type ViewMode = 'renter' | 'business'

const COOKIE_NAME = 'kuruma-view'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function isBusiness(role: string | undefined): boolean {
  return isBusinessRole(role)
}

/**
 * Pure resolver (functional core): renters can never switch views; business
 * users honour their saved preference, defaulting to the business view.
 */
export function resolveViewMode(
  role: string | undefined,
  cookieValue: string | undefined,
): ViewMode {
  if (!isBusiness(role)) return 'renter'
  return cookieValue === 'renter' ? 'renter' : 'business'
}

function readViewCookie(): string | undefined {
  const match = document.cookie.split('; ').find((pair) => pair.startsWith(`${COOKIE_NAME}=`))
  return match?.slice(COOKIE_NAME.length + 1)
}

export function getViewMode(role: string | undefined): ViewMode {
  return resolveViewMode(role, readViewCookie())
}

/**
 * Persist the chosen view. Unlike the old Next server action this cookie is
 * deliberately NOT httpOnly: the SPA is the only reader, so JS must be able to
 * read it back on the next render.
 */
export function setViewMode(mode: ViewMode): void {
  document.cookie = `${COOKIE_NAME}=${mode}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
