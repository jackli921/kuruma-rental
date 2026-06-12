import type { NavItem } from '@/vite/nav/MobileMenu'
import { Navbar } from '@/vite/nav/Navbar'
import type { Session } from '@/vite/session'
import { useSession } from '@/vite/session'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const mockUseSession = vi.mocked(useSession)
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
  document.cookie = 'kuruma-view=; max-age=0; path=/'
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
    // #530: operator pricing config (insurance) lives at /manage/insurance.
    expect(screen.getByText('Insurance').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/manage/insurance',
    )
    expect(container.querySelector('nav')?.hasAttribute('data-business-nav')).toBe(true)
    const client = screen.getByTestId('navbar-client')
    expect(client).toHaveAttribute('data-view-mode', 'business')
    expect(client).toHaveAttribute('data-can-switch', 'true')
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '5')
  })

  it('shows Browse, My Bookings, and Documents (no business markers) for a signed-in renter', () => {
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
    const client = screen.getByTestId('navbar-client')
    expect(client).toHaveAttribute('data-view-mode', 'renter')
    expect(client).toHaveAttribute('data-can-switch', 'false')
    // Desktop + mobile share the same derived navItems (Browse + 2 renter-only).
    expect(screen.getByTestId('mobile-menu')).toHaveAttribute('data-nav-count', '3')
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
