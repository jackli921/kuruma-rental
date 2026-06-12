import { AdminSidebar } from '@/vite/nav/AdminSidebar'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Mirror the Navbar test: stub the typed router Link to a plain anchor so the
// unit test asserts our wiring (to + labels), not TanStack's active-class
// behavior (framework code — proven by the admin-portal E2E instead).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
  }: {
    to: string
    params?: unknown
    activeProps?: unknown
    activeOptions?: unknown
    children: ReactNode
  }) => (
    <a data-to={to} href={to}>
      {children}
    </a>
  ),
}))

function renderSidebar() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <AdminSidebar />
    </IntlProvider>,
  )
}

describe('AdminSidebar', () => {
  it('renders the overview + revenue links with admin.nav labels', () => {
    renderSidebar()
    expect(screen.getByText('Overview').closest('a')).toHaveAttribute('data-to', '/$locale/admin')
    expect(screen.getByText('Partner Revenue').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/admin/revenue',
    )
  })

  it('marks its root with data-admin-sidebar so the global nav is suppressed', () => {
    // globals.css: `:root:has([data-admin-sidebar]) [data-global-nav]` is hidden.
    // Without this marker the always-mounted <Navbar/> double-renders on /admin.
    const { container } = renderSidebar()
    expect(container.querySelector('aside')?.hasAttribute('data-admin-sidebar')).toBe(true)
  })
})
