import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import type { UserRole } from '@kuruma/shared/auth/roles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Drive the signed-in role through the session hook; the sidebar's own seams
// (router Link, feature flags, badge query) are mocked so this exercises the
// layout's wiring — preference + view-cookie → render/omit the sidebar.
// Typed as UserRole | undefined (not string) so a typo'd literal here fails to
// compile — that's the whole point of #1111's narrowing (audit M6).
const h = vi.hoisted(() => ({
  role: 'OPERATOR_OWNER' as UserRole | undefined,
  operatorId: undefined as string | undefined,
  // The active route id the layout's useIsOperatorContextRoute hook reads. Defaults
  // to a route that honors ?operator (add-ons) so picker tests aren't route-gated;
  // the unsupported-route test flips it to dashboard.
  routeId: '/$locale/_business/manage/add-ons' as string,
}))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'u1', role: h.role, operatorId: h.operatorId } } }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: unknown }) => (
    <a href={String(to)}>{children}</a>
  ),
  // The operator picker (rendered for a PLATFORM_ADMIN) resolves its search +
  // navigate through the `_business` route api; stub it so the real picker mounts.
  getRouteApi: () => ({
    useSearch: () => ({ operator: undefined }),
    useNavigate: () => () => {},
  }),
  // useIsOperatorContextRoute reads the active match chain to decide whether the
  // current route honors ?operator; feed it the route id under test.
  useRouterState: ({ select }: { select: (s: { matches: { routeId: string }[] }) => unknown }) =>
    select({ matches: [{ routeId: '/$locale/_business' }, { routeId: h.routeId }] }),
}))
vi.mock('@/vite/config/features', () => ({
  isOperatorTeamEnabled: () => true,
  isOperatorSettingsEnabled: () => true,
}))
vi.mock('@/vite/operator-bookings/useNewBookingsBadge', () => ({
  useNewBookingsBadge: () => ({ count: 0 }),
}))
// Stub the picker's option query so useQuery never hits the network.
vi.mock('@/vite/operator-context/api', () => ({
  operatorsQueryOptions: () => ({ queryKey: ['ops-test'], queryFn: async () => [] }),
  fetchOperators: async () => [],
}))

import { BusinessLayout } from './BusinessLayout'

const STORAGE_KEY = 'kuruma-layout-preference'

function renderLayout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <LayoutPreferenceProvider>
          <BusinessLayout>
            <div>PAGE CONTENT</div>
          </BusinessLayout>
        </LayoutPreferenceProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

function renderBusinessLayout({
  role,
  operatorId,
}: { role: UserRole | undefined; operatorId?: string }) {
  h.role = role
  h.operatorId = operatorId
  return renderLayout()
}

describe('BusinessLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'kuruma-view=; path=/; max-age=0'
    h.role = 'OPERATOR_OWNER'
    h.operatorId = undefined
    h.routeId = '/$locale/_business/manage/add-ons'
  })

  it('renders the operator sidebar beside the page when the operator prefers the sidebar', () => {
    localStorage.setItem(STORAGE_KEY, 'sidebar')
    const { container } = renderLayout()
    expect(container.querySelector('[data-business-sidebar]')).not.toBeNull()
    expect(screen.queryByText('PAGE CONTENT')).not.toBeNull()
  })

  it('renders only the page with no sidebar when the operator prefers the top nav (bug repro)', () => {
    localStorage.setItem(STORAGE_KEY, 'topnav')
    const { container } = renderLayout()
    expect(container.querySelector('[data-business-sidebar]')).toBeNull()
    expect(screen.queryByText('PAGE CONTENT')).not.toBeNull()
  })

  it('suppresses the sidebar for an operator who switched to renter view (P1 wiring)', () => {
    localStorage.setItem(STORAGE_KEY, 'sidebar')
    document.cookie = 'kuruma-view=renter; path=/'
    const { container } = renderLayout()
    expect(container.querySelector('[data-business-sidebar]')).toBeNull()
    expect(screen.queryByText('PAGE CONTENT')).not.toBeNull()
  })

  it('shows the operator picker for a PLATFORM_ADMIN on a route that honors ?operator', () => {
    renderBusinessLayout({ role: 'PLATFORM_ADMIN' })
    expect(screen.getByLabelText('Operator')).not.toBeNull()
  })

  it('hides the operator picker for a PLATFORM_ADMIN on a route that does not honor ?operator', () => {
    h.routeId = '/$locale/_business/dashboard'
    renderBusinessLayout({ role: 'PLATFORM_ADMIN' })
    expect(screen.queryByLabelText('Operator')).toBeNull()
  })

  it('hides the operator picker for an operator session', () => {
    renderBusinessLayout({ role: 'OPERATOR_OWNER', operatorId: 'op_1' })
    expect(screen.queryByLabelText('Operator')).toBeNull()
  })
})
