import { UserMenu } from '@/vite/nav/UserMenu'
import type { Session } from '@/vite/session'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// base-ui's dropdown portals its content only when open. Passthrough-mock it so
// the menu items render inline (the codebase's pattern for nav dropdowns), and
// stub the typed router Link to a plain anchor exposing its `to`.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => (
    <>{render ?? <div>{children}</div>}</>
  ),
  DropdownMenuSeparator: () => <hr />,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; params?: unknown; children: ReactNode }) => (
    // href is required for the anchor to expose role="link" to getByRole.
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))

function renderMenu(role: string) {
  const session: Session = {
    user: { id: 'u', role, name: 'Pat Admin', email: 'pat@example.com' },
    csrfToken: 'csrf',
  }
  return render(
    <IntlProvider locale="en" messages={en}>
      <UserMenu session={session} canSwitchView={false} viewMode="business" />
    </IntlProvider>,
  )
}

describe('UserMenu — platform admin link', () => {
  it('shows a Platform Admin link to /admin for a platform admin', () => {
    renderMenu('PLATFORM_ADMIN')
    expect(screen.getByRole('link', { name: 'Platform Admin' })).toHaveAttribute(
      'data-to',
      '/$locale/admin',
    )
  })

  it('hides the admin link for a non-admin (renter)', () => {
    renderMenu('RENTER')
    expect(screen.queryByRole('link', { name: 'Platform Admin' })).toBeNull()
  })
})
