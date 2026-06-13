import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Pure presentational view (FC/IS): the route owns the fetch, this renders the
// resolved overview. Mock the i18n hook (use-intl) and the typed Link so the
// component renders in happy-dom without a router/intl provider.
vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'dashboard.title': 'Dashboard',
      'dashboard.subtitle': 'Overview of your rental business',
      'dashboard.viewBookings': 'View bookings',
      'dashboard.manageFleet': 'Manage fleet',
      'stats.totalBookings': 'Total Bookings',
      'stats.activeVehicles': 'Active Vehicles',
      'stats.upcomingBookings': 'Upcoming Bookings',
    }
    return messages[key] ?? key
  },
}))

vi.mock('@tanstack/react-router', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub for the typed Link
  Link: ({ to, children, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { OperatorDashboardView } from '@/vite/operator-dashboard/OperatorDashboardView'

describe('OperatorDashboardView', () => {
  afterEach(cleanup)

  it('renders the three operator-scoped stat tiles with their values', () => {
    render(
      <OperatorDashboardView
        overview={{ totalBookings: 12, activeVehicles: 5, upcomingBookings: 3 }}
        locale="en"
      />,
    )
    expect(screen.getByText('Total Bookings')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Active Vehicles')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Upcoming Bookings')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('links to the operator bookings and fleet routes', () => {
    render(
      <OperatorDashboardView
        overview={{ totalBookings: 0, activeVehicles: 0, upcomingBookings: 0 }}
        locale="ja"
      />,
    )
    expect(screen.getByRole('link', { name: 'View bookings' })).toHaveAttribute(
      'href',
      '/$locale/manage/bookings',
    )
    expect(screen.getByRole('link', { name: 'Manage fleet' })).toHaveAttribute(
      'href',
      '/$locale/manage/fleet',
    )
  })

  it('renders a zero state for an empty tenant without crashing', () => {
    render(
      <OperatorDashboardView
        overview={{ totalBookings: 0, activeVehicles: 0, upcomingBookings: 0 }}
        locale="en"
      />,
    )
    expect(screen.getAllByText('0')).toHaveLength(3)
  })
})
