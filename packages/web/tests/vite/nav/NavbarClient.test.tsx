import { NavbarClient } from '@/vite/nav/NavbarClient'
import type { Session } from '@/vite/session'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; params?: unknown; children: ReactNode }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))

const session: Session = {
  user: { id: 'u1', role: 'OPERATOR_OWNER', name: 'Aiko Tanaka', email: 'aiko@example.com' },
  csrfToken: 'csrf-1',
}

function renderClient(props: {
  session: Session | null
  canSwitchView?: boolean
  viewMode?: 'renter' | 'business'
}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <NavbarClient
        session={props.session}
        canSwitchView={props.canSwitchView ?? true}
        viewMode={props.viewMode ?? 'business'}
      />
    </IntlProvider>,
  )
}

describe('NavbarClient', () => {
  it('shows a login link to the locale-scoped login route when signed out', () => {
    renderClient({ session: null })
    expect(screen.getByRole('link')).toHaveAttribute('data-to', '/$locale/login')
  })

  it('shows the user menu (not a login link) when signed in', () => {
    renderClient({ session })
    expect(screen.getByText('Aiko Tanaka')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the layout toggle only in the business view, with an accessible name', () => {
    renderClient({ session, viewMode: 'business' })
    const toggle = screen.getByRole('button', { name: 'Switch to top navigation' })
    // Binary layout toggle, not a disclosure: aria-pressed, never aria-expanded.
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).not.toHaveAttribute('aria-expanded')
  })

  it('hides the layout toggle in the renter view', () => {
    renderClient({ session, viewMode: 'renter' })
    expect(screen.queryByRole('button', { name: 'Switch to top navigation' })).toBeNull()
  })
})
