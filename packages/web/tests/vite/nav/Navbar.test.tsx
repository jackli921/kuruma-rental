import type { NavItem } from '@/vite/nav/MobileMenu'
import { Navbar } from '@/vite/nav/Navbar'
import { businessNavItems } from '@/vite/nav/business-nav-items'
import { useNewBookingsBadge } from '@/vite/operator-bookings/useNewBookingsBadge'
import type { Session } from '@/vite/session'
import { useSession } from '@/vite/session'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@/vite/session', () => ({ useSession: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; params?: unknown; children: ReactNode }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
}))
// Stub the children: Navbar's own job is deriving navItems / data-attrs and
// passing the right props down. Echo the props we assert on.
vi.mock('@/vite/nav/NavbarClient', () => ({
  NavbarClient: ({
    session,
    viewMode,
    canSwitchView,
  }: { session: Session | null; viewMode: string; canSwitchView: boolean }) => (
    <div
      data-testid="navbar-client"
      data-signed-in={String(!!session?.user)}
      data-view-mode={viewMode}
      data-can-switch={String(canSwitchView)}
    />
  ),
}))
vi.mock('@/vite/nav/MobileMenu', () => ({
  MobileMenu: ({
    session,
    navItems,
  }: { session: Session | null; navItems: readonly NavItem[] }) => (
    <div
      data-testid="mobile-menu"
      data-signed-in={String(!!session?.user)}
      data-nav-count={String(navItems.length)}
    />
  ),
}))
vi.mock('@/vite/nav/LocaleSwitcher', () => ({
  LocaleSwitcher: () => <div data-testid="locale-switcher" />,
}))
// #611: the new-order badge count is a data hook; Navbar's job is to render the
// dot on the Bookings item in business view only. Stub the count source.
vi.mock('@/vite/operator-bookings/useNewBookingsBadge', () => ({
  useNewBookingsBadge: vi.fn(() => ({ count: 0 })),
}))

const mockUseSession = vi.mocked(useSession)
const mockUseBadge = vi.mocked(useNewBookingsBadge)
const business: Session = {
  user: { id: 'u1', role: 'OPERATOR_OWNER', name: 'Aiko', email: 'aiko@example.com' },
  csrfToken: 'csrf-1',
}
const renter: Session = {
  user: { id: 'u2', role: 'RENTER', name: 'Ben', email: 'ben@example.com' },
  csrfToken: 'csrf-2',
}

function renderNavbar(data: Session | undefined) {
  mockUseSession.mockReturnValue({ data } as unknown as ReturnType<typeof useSession>)
  return render(
    <IntlProvider locale="en" messages={en}>
      <Navbar />
    </IntlProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseBadge.mockReturnValue({ count: 0 })
  document.cookie = 'kuruma-view=; max-age=0; path=/'
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Navbar', () => {
  it('links the logo to the locale home and shows no nav links when signed out', () => {
    renderNavbar(undefined)
    expect(screen.getByText('Kuruma').closest('a')).toHaveAttribute('data-to', '/$locale')
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('Bookings')).toBeNull()
    expect(screen.getByTestId('navbar-client')).toHaveAttribute('data-signed-in', 'false')
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '0')
  })

  it('shows the dashboard, operator bookings + fleet + classes + insurance links and business markers for a business user', () => {
    mockUseBadge.mockReturnValue({ count: 3 })
    // Team + Settings are post-MVP add-ons gated behind feature flags; turn them
    // on so this "full operator nav" assertion sees every route.
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', 'true')
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', 'true')
    const { container } = renderNavbar(business)
    expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/dashboard',
    )
    // #512: the operator booking view lives at /manage/bookings (the renter owns
    // /bookings), and a business user must be able to navigate to it.
    expect(screen.getByText('Bookings').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/bookings',
    )
    // #526: the operator fleet management view lives at /manage/fleet.
    expect(screen.getByText('Fleet').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/fleet',
    )
    // #528: operator vehicle-classes management.
    expect(screen.getByText('Classes').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/classes',
    )
    // #529: the operator locations/storefronts view lives at /manage/locations.
    expect(screen.getByText('Locations').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/locations',
    )
    // #530: operator pricing config (insurance) lives at /manage/insurance.
    expect(screen.getByText('Insurance').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/insurance',
    )
    // #530: operator pricing config (fees) lives at /manage/fees.
    expect(screen.getByText('Fees').closest('a')).toHaveAttribute('data-to', '/$locale/manage/fees')
    // #585: operator add-on management lives at /manage/add-ons.
    expect(screen.getByText('Add-ons').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/add-ons',
    )
    // #904 / #903: shown only because the flags above are on (full build).
    expect(screen.getByText('Team').closest('a')).toHaveAttribute('data-to', '/$locale/manage/team')
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/settings',
    )
    expect(container.querySelector('nav')?.hasAttribute('data-business-nav')).toBe(true)
    const client = screen.getByTestId('navbar-client')
    expect(client).toHaveAttribute('data-view-mode', 'business')
    expect(client).toHaveAttribute('data-can-switch', 'true')
    // Derived from the shared source of truth, not a magic number — adding a
    // /manage/* route to businessNavItems keeps this assertion correct (#603).
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute(
      'data-nav-count',
      String(businessNavItems.length),
    )
    // #611: a red-dot count rides the Bookings item (and only that item).
    const bookingsLink = screen.getByText('Bookings').closest('a') as HTMLElement
    const badge = within(bookingsLink).getByRole('status')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('aria-label', '3 new bookings')
    // It is not duplicated onto another nav item.
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('hides Team + Settings nav in the beta MVP demo (their post-MVP flags are off)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_TEAM', undefined)
    vi.stubEnv('VITE_FEATURE_OPERATOR_SETTINGS', undefined)
    renderNavbar(business)
    // The MVP operator routes still render…
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Bookings')).toBeInTheDocument()
    // …but the two add-on routes are filtered out of the rendered nav.
    expect(screen.queryByText('Team')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute(
      'data-nav-count',
      String(businessNavItems.length - 2),
    )
  })

  it('shows Browse, My Bookings, and Documents (no business markers) for a signed-in renter', () => {
    // Even with a non-zero count, the operator badge is gated to business view.
    mockUseBadge.mockReturnValue({ count: 5 })
    // Documents is a post-MVP add-on gated behind a flag; enable it so this
    // "full renter nav" assertion sees it (the OFF case is its own test below).
    vi.stubEnv('VITE_FEATURE_RENTER_DOCUMENTS', 'true')
    const { container } = renderNavbar(renter)
    expect(screen.getByText('Browse').closest('a')).toHaveAttribute('data-to', '/$locale/search')
    expect(screen.getByText('My Bookings').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/bookings',
    )
    expect(screen.getByText('Documents').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/documents',
    )
    expect(container.querySelector('nav')?.hasAttribute('data-business-nav')).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
    const client = screen.getByTestId('navbar-client')
    expect(client).toHaveAttribute('data-view-mode', 'renter')
    expect(client).toHaveAttribute('data-can-switch', 'false')
    // Desktop + mobile share the same derived navItems (Browse + 2 renter-only).
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '3')
  })

  it('hides Documents in the beta MVP demo (renter-documents flag off)', () => {
    renderNavbar(renter)
    expect(screen.getByText('Browse')).toBeInTheDocument()
    expect(screen.getByText('My Bookings')).toBeInTheDocument()
    // The orphaned IDP-upload page is filtered out — Browse + My Bookings only.
    expect(screen.queryByText('Documents')).toBeNull()
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '2')
  })

  it('hides My Bookings/Documents for an operator in renter view — gating is by role, not view (P1, AC6)', () => {
    // Operator switched to renter view: viewMode is renter, but role is not RENTER,
    // so the personal "my data" nav must not appear (it would otherwise drift to
    // tenant data). Browse stays — it is public and role-agnostic.
    document.cookie = 'kuruma-view=renter; path=/'
    renderNavbar(business)
    expect(screen.getByText('Browse')).toBeInTheDocument()
    expect(screen.queryByText('My Bookings')).toBeNull()
    expect(screen.queryByText('Documents')).toBeNull()
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '1')
  })
})
