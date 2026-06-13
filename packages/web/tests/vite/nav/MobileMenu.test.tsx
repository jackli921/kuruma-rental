import { MobileMenu, type NavItem } from '@/vite/nav/MobileMenu'
import type { Session } from '@/vite/session'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const signOut = vi.fn().mockResolvedValue(undefined)
const invalidateQueries = vi.fn().mockResolvedValue(undefined)
const invalidate = vi.fn().mockResolvedValue(undefined)

vi.mock('@/vite/session', () => ({ signOut: (token: string) => signOut(token) }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    to,
    onClick,
    children,
  }: { to: string; params?: unknown; onClick?: () => void; children: ReactNode }) => (
    <a data-to={to} href={to} onClick={onClick}>
      {children}
    </a>
  ),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }))
// Replace the base-ui Sheet (portal-backed, flaky to open in happy-dom) with a
// passthrough so the menu body renders inline and we test branch logic, not the
// portal open state.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ render }: { render: ReactElement }) => render,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const session: Session = {
  user: { id: 'u1', role: 'RENTER', name: 'Aiko Tanaka', email: 'aiko@example.com' },
  csrfToken: 'csrf-1',
}
const bookings: NavItem[] = [{ to: '/$locale/bookings', label: 'Bookings' }]

function renderMenu(props: { session: Session | null; navItems?: readonly NavItem[] }) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <MobileMenu session={props.session} navItems={props.navItems ?? []} />
    </IntlProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('MobileMenu', () => {
  it('shows a locale-scoped login link and no user info when signed out', () => {
    renderMenu({ session: null })
    expect(screen.getByText('Log in').closest('a')).toHaveAttribute('data-to', '/$locale/login')
    expect(screen.queryByText('Aiko Tanaka')).toBeNull()
  })

  it('shows user identity and locale-scoped nav links when signed in', () => {
    renderMenu({ session, navItems: bookings })
    expect(screen.getByText('Aiko Tanaka')).toBeInTheDocument()
    expect(screen.getByText('aiko@example.com')).toBeInTheDocument()
    expect(screen.getByText('Bookings').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/bookings',
    )
  })

  it('renders the new-order red-dot badge on a nav item that carries a count (#611)', () => {
    renderMenu({
      session,
      navItems: [{ to: '/$locale/manage/bookings', label: 'Bookings', badge: 3 }],
    })
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('3')
    expect(badge).toHaveAttribute('aria-label', '3 new bookings')
  })

  it('signs out with the CSRF token then invalidates the session and router', async () => {
    renderMenu({ session, navItems: bookings })
    fireEvent.click(screen.getByText('Log out'))
    await waitFor(() => expect(signOut).toHaveBeenCalledWith('csrf-1'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['session'] })
    expect(invalidate).toHaveBeenCalled()
  })
})
