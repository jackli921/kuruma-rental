import { isVisibleToViewer } from '@/vite/config'
import type { UserRole } from '@kuruma/shared/auth/roles'

// Single source of truth for the business-view (operator) nav (#603). Both
// Navbar (which builds the desktop list and passes it to MobileMenu) and
// MobileMenu's `NavTo` union derive from THIS array, so adding a `/manage/*`
// route is a one-line edit here instead of the three-way "nav-link conflict
// tax" — Navbar array + MobileMenu union + the nav-count test — that every
// operator-portal slice (#528/#529/#530/#585…) used to pay.
//
// `labelKey` is a key under the `nav` i18n namespace; the caller resolves it
// with useTranslations('nav'). `to` values are real TanStack route literals so
// the typed <Link> compiles (a plain string would fail typecheck).
export const businessNavItems = [
  { to: '/$locale/dashboard', labelKey: 'dashboard' },
  { to: '/$locale/manage/bookings', labelKey: 'bookings' },
  { to: '/$locale/manage/fleet', labelKey: 'fleet' },
  { to: '/$locale/manage/classes', labelKey: 'classes' },
  { to: '/$locale/manage/locations', labelKey: 'locations' },
  { to: '/$locale/manage/insurance', labelKey: 'insurance' },
  { to: '/$locale/manage/terms', labelKey: 'terms' },
  { to: '/$locale/manage/fees', labelKey: 'fees' },
  { to: '/$locale/manage/add-ons', labelKey: 'addOns' },
  { to: '/$locale/manage/messages', labelKey: 'messages' },
  { to: '/$locale/manage/team', labelKey: 'team' },
  { to: '/$locale/manage/settings', labelKey: 'settings' },
] as const

// Derived so the union can never drift from the array above.
export type BusinessNavTo = (typeof businessNavItems)[number]['to']

// The effective (runtime-toggleable) values of the flags this nav gates on. The
// component reads them with useFeatureFlag and passes them in, so this stays a pure
// function — unit-testable without a provider and free of the build-time reader.
export interface BusinessNavFlags {
  readonly messaging: boolean
  readonly operatorTeam: boolean
  readonly operatorSettings: boolean
  readonly operatorTerms: boolean
}

// Post-MVP routes the beta demo hides behind a feature flag (billable add-ons).
// The array above stays the full source of truth so the `BusinessNavTo` union and
// the nav-count test never drift; only the RENDERED list is filtered. The routes
// themselves also redirect when their flag is OFF, so a direct URL can't reach them.
// Messages is the post-MVP messaging feature: hidden in beta but shown to the
// platform admin (owner preview via admin bypass), mirroring the renter side — so
// its gate is role-aware (isVisibleToViewer), unlike the flag-only team/settings.
export function visibleBusinessNavItems(
  role: UserRole | undefined,
  flags: BusinessNavFlags,
): readonly (typeof businessNavItems)[number][] {
  const navItemGates: Partial<Record<BusinessNavTo, (role: UserRole | undefined) => boolean>> = {
    '/$locale/manage/messages': (r) => isVisibleToViewer(flags.messaging, r),
    '/$locale/manage/team': () => flags.operatorTeam,
    '/$locale/manage/settings': () => flags.operatorSettings,
    '/$locale/manage/terms': () => flags.operatorTerms,
  }
  return businessNavItems.filter((item) => navItemGates[item.to]?.(role) ?? true)
}
