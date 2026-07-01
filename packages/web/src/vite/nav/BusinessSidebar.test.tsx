import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Hoisted so the (hoisted) vi.mock factories below can read them; tests mutate
// these to drive the feature flags and the new-bookings count.
const h = vi.hoisted(() => ({
  flags: { team: true, settings: true },
  badge: { count: 0 },
  messaging: { enabled: false },
  unread: { count: 0 },
  role: 'OPERATOR_OWNER' as string | undefined,
}))

// The router <Link> is a navigation primitive — mock it to a plain anchor so the
// unit scope stays the sidebar's own rendering. Real navigation + active-state
// (aria-current on nested routes) is integration behavior, covered by E2E.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: unknown }) => (
    <a href={String(to)}>{children}</a>
  ),
}))

vi.mock('@/vite/config/features', () => ({
  isOperatorTeamEnabled: () => h.flags.team,
  isOperatorSettingsEnabled: () => h.flags.settings,
}))

vi.mock('@/vite/config', () => ({
  isMessagingEnabled: () => h.messaging.enabled,
  isVisibleToViewer: (flag: boolean, role: string | undefined) => flag || role === 'PLATFORM_ADMIN',
}))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { role: h.role } } }),
}))

vi.mock('@/vite/operator-bookings/useNewBookingsBadge', () => ({
  useNewBookingsBadge: () => ({ count: h.badge.count }),
}))

vi.mock('@/vite/messaging', () => ({
  useOperatorUnreadBadge: () => ({ count: h.unread.count }),
}))

import { BusinessSidebar } from './BusinessSidebar'

function renderSidebar() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <BusinessSidebar />
    </IntlProvider>,
  )
}

describe('BusinessSidebar', () => {
  beforeEach(() => {
    h.flags.team = true
    h.flags.settings = true
    h.badge.count = 0
    h.messaging.enabled = false
    h.unread.count = 0
    h.role = 'OPERATOR_OWNER'
  })

  it('emits the data-business-sidebar attribute the CSS hide rule depends on', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('[data-business-sidebar]')).not.toBeNull()
  })

  it('renders a link with the translated label for every visible business nav item, in order', () => {
    renderSidebar()
    const labels = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(labels).toEqual([
      'Dashboard',
      'Bookings',
      'Fleet',
      'Classes',
      'Locations',
      'Insurance',
      'Fees',
      'Add-ons',
      'Team',
      'Settings',
    ])
  })

  it('hides Team and Settings when their operator feature flags are off', () => {
    h.flags.team = false
    h.flags.settings = false
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeNull()
  })

  it('shows the new-bookings badge on the Bookings item when the count is positive', () => {
    h.badge.count = 3
    renderSidebar()
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('3')
    expect(badge.getAttribute('aria-label')).toBe('3 new bookings')
  })

  it('renders no badge when there are no new bookings', () => {
    h.badge.count = 0
    renderSidebar()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides Messages for an operator while the messaging flag is off', () => {
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Messages' })).toBeNull()
  })

  it('shows Messages when the messaging flag is on', () => {
    h.messaging.enabled = true
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeNull()
  })

  it('shows Messages to the platform admin even when the flag is off (owner preview)', () => {
    h.role = 'PLATFORM_ADMIN'
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeNull()
  })

  it('shows the operator unread badge on Messages when positive', () => {
    h.messaging.enabled = true
    h.unread.count = 4
    renderSidebar()
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('4')
    expect(badge.getAttribute('aria-label')).toBe('4 unread messages')
  })
})
