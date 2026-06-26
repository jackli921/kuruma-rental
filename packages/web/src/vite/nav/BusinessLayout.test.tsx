import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import type { UserRole } from '@kuruma/shared/auth/roles'
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
const h = vi.hoisted(() => ({ role: 'OPERATOR_OWNER' as UserRole | undefined }))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'u1', role: h.role } } }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: unknown }) => (
    <a href={String(to)}>{children}</a>
  ),
}))
vi.mock('@/vite/config/features', () => ({
  isOperatorTeamEnabled: () => true,
  isOperatorSettingsEnabled: () => true,
}))
vi.mock('@/vite/operator-bookings/useNewBookingsBadge', () => ({
  useNewBookingsBadge: () => ({ count: 0 }),
}))

import { BusinessLayout } from './BusinessLayout'

const STORAGE_KEY = 'kuruma-layout-preference'

function renderLayout() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <LayoutPreferenceProvider>
        <BusinessLayout>
          <div>PAGE CONTENT</div>
        </BusinessLayout>
      </LayoutPreferenceProvider>
    </IntlProvider>,
  )
}

describe('BusinessLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'kuruma-view=; path=/; max-age=0'
    h.role = 'OPERATOR_OWNER'
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
})
