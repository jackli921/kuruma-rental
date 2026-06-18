import { resolveViewMode } from '@/vite/view-mode'

export type LayoutPreference = 'sidebar' | 'topnav'

/**
 * Functional core: should the business sidebar be shown? True only when the user
 * both prefers the sidebar AND is actually in business view. The view check folds
 * in role + the `kuruma-view` cookie (resolveViewMode), so an operator who switched
 * to renter view while still on a `_business` route gets no business chrome (P1).
 */
export function shouldShowBusinessSidebar(
  preference: LayoutPreference,
  role: string | undefined,
  cookieValue: string | undefined,
): boolean {
  return preference === 'sidebar' && resolveViewMode(role, cookieValue) === 'business'
}
