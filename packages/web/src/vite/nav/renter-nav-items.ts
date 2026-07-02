import { isVisibleToViewer } from '@/vite/config'
import type { UserRole } from '@kuruma/shared/auth/roles'

// Single source of truth for the renter-view nav (#543), mirroring
// business-nav-items.ts: Navbar builds the desktop list from this and passes it to
// MobileMenu, so the desktop array and the mobile union can never drift.
// `labelKey` is a key under the `nav` i18n namespace; the caller resolves it with
// useTranslations('nav'). `to` values are real TanStack route literals so the typed
// <Link> compiles.
export const renterNavItems = [
  { to: '/$locale/bookings', labelKey: 'myBookings' },
  { to: '/$locale/messages', labelKey: 'messages' },
  { to: '/$locale/documents', labelKey: 'documents' },
] as const

// Derived so the union can never drift from the array above.
export type RenterNavTo = (typeof renterNavItems)[number]['to']

// The effective (runtime-toggleable) values of the flags this nav gates on. The
// component reads them with useFeatureFlag and passes them in, keeping this a pure
// function — unit-testable without a provider and free of the build-time reader.
export interface RenterNavFlags {
  readonly messaging: boolean
  readonly renterDocuments: boolean
}

// Per-item visibility (design: docs/plans/2026-06-26-mvp-feature-gating-design.md §4.1).
// My Bookings and Documents are personal "my data" pages, gated on the REAL renter
// role — an operator/admin in renter view must not see them (view state is not
// authorization state). Messages is a post-MVP feature hidden in beta but shown to
// the platform admin so the owner can preview it (admin bypass), so it is gated by
// isVisibleToViewer and is deliberately NOT coupled to isRenter. Documents also needs
// its own build-time flag (#459, OFF in beta).
export function visibleRenterNavItems(
  role: UserRole | undefined,
  flags: RenterNavFlags,
): readonly (typeof renterNavItems)[number][] {
  const isRenter = role === 'RENTER'
  const gates: Record<RenterNavTo, boolean> = {
    '/$locale/bookings': isRenter,
    '/$locale/messages': isVisibleToViewer(flags.messaging, role),
    '/$locale/documents': isRenter && flags.renterDocuments,
  }
  return renterNavItems.filter((item) => gates[item.to])
}
