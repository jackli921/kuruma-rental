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
  { to: '/$locale/manage/fees', labelKey: 'fees' },
  { to: '/$locale/manage/add-ons', labelKey: 'addOns' },
] as const

// Derived so the union can never drift from the array above.
export type BusinessNavTo = (typeof businessNavItems)[number]['to']
