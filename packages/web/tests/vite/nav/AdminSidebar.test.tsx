import { FeatureFlagsProvider } from '@/vite/config'
import { AdminSidebar } from '@/vite/nav/AdminSidebar'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const TEMPLATES_LINK = '[data-to="/$locale/admin/templates"]'

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

// Seed the runtime override map so FeatureFlagsProvider reads it from cache (no
// fetch), mirroring the BusinessSidebar test — lets us drive a flag-gated link.
function renderSidebarWithFlags(overrides: FeatureFlagOverrides) {
  const client = new QueryClient()
  client.setQueryData(['feature-flags'], overrides)
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <AdminSidebar />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
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

  it('renders a Back to site link to the marketplace home so the admin can leave the portal', () => {
    renderSidebar()
    expect(screen.getByText('Back to site').closest('a')).toHaveAttribute('data-to', '/$locale')
  })

  it('shows the template library link when the shared catalog is on (default)', () => {
    // No provider -> SHARED_CATALOG floors to its registry serverDefault (ON), #1437.
    const { container } = renderSidebar()
    expect(container.querySelector(TEMPLATES_LINK)).not.toBeNull()
  })

  it('hides the template library link when the shared catalog is switched off (#1437)', () => {
    const { container } = renderSidebarWithFlags({ SHARED_CATALOG: false })
    expect(container.querySelector(TEMPLATES_LINK)).toBeNull()
  })

  it('marks its root with data-admin-sidebar so the global nav is suppressed', () => {
    // globals.css: `:root:has([data-admin-sidebar]) [data-global-nav]` is hidden.
    // Without this marker the always-mounted <Navbar/> double-renders on /admin.
    const { container } = renderSidebar()
    expect(container.querySelector('aside')?.hasAttribute('data-admin-sidebar')).toBe(true)
  })
})
