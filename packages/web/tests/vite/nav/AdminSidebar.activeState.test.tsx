import { AdminSidebar } from '@/vite/nav/AdminSidebar'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

// Unlike AdminSidebar.test.tsx (which stubs Link to a plain anchor), this mounts a
// REAL TanStack router so the framework's active-prop behavior runs: an active
// <Link> is auto-given `aria-current="page"`, and a NON-exact match treats
// `/$locale` as active on every `/$locale/admin/*` route. Without exact matching
// the "Back to site" escape hatch lights up as the current section on every admin
// page (and mis-announces itself to screen readers). Stubbed Link can't see this.
function renderAdminSidebarAt(pathname: string) {
  const rootRoute = createRootRoute()
  const localeRoute = createRoute({ getParentRoute: () => rootRoute, path: '$locale' })
  const adminRoute = createRoute({ getParentRoute: () => localeRoute, path: 'admin' })
  const sidebarChild = (path: string) =>
    createRoute({ getParentRoute: () => adminRoute, path, component: () => <AdminSidebar /> })
  const routeTree = rootRoute.addChildren([
    localeRoute.addChildren([
      adminRoute.addChildren([
        sidebarChild('/'),
        sidebarChild('bookings'),
        sidebarChild('revenue'),
        sidebarChild('anomalies'),
        sidebarChild('documents'),
        sidebarChild('customers'),
        sidebarChild('governance'),
      ]),
    ]),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  })
  render(
    <IntlProvider locale="en" messages={en}>
      <RouterProvider router={router} />
    </IntlProvider>,
  )
}

describe('AdminSidebar active state (real router)', () => {
  it('does not mark "Back to site" as the current page on a nested admin route', async () => {
    renderAdminSidebarAt('/en/admin/bookings')
    const backToSite = (await screen.findByText('Back to site')).closest('a')
    expect(backToSite).not.toHaveAttribute('aria-current')
  })

  it('marks only the matched section link as the current page', async () => {
    renderAdminSidebarAt('/en/admin/bookings')
    expect((await screen.findByText('Bookings')).closest('a')).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Exact matching on section links: the /admin index stays inactive on a child route.
    expect(screen.getByText('Overview').closest('a')).not.toHaveAttribute('aria-current')
  })
})
