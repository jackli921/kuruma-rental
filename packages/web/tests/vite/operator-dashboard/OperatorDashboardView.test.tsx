import { OperatorDashboardView } from '@/vite/operator-dashboard/OperatorDashboardView'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The view mounts the compliance banner (#916 §5.5), which links to the fleet via
// TanStack's Link; stub it as a plain anchor so the view renders without a router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const overview: OperatorOverview = {
  totalBookings: 12,
  activeVehicles: 5,
  upcomingBookings: 3,
  today: { pickups: [], returns: [], overdue: [] },
}

function vehicle(overrides: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: 'v1',
    operatorId: 'op_1',
    classId: null,
    pickupLocationId: null,
    name: 'Toyota Aqua',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'なにわ 300 あ 12-34',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Aqua',
    year: 2022,
    color: null,
    dailyRateJpy: 6800,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-01-01',
    insuranceExpiryDate: '2099-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...overrides,
  }
}

// session=null: the #1102 Today panel gates itself off for a non-operator viewer,
// so it renders nothing and stays clear of these tiles/compliance assertions. The
// QueryClientProvider is still required — TodayPanel calls useQueryClient/useMutation
// before its early return (rules of hooks).
function renderDashboard(vehicles: OperatorFleetVehicle[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorDashboardView overview={overview} vehicles={vehicles} session={null} locale="en" />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorDashboardView', () => {
  it('renders the three operator stat tiles', () => {
    renderDashboard([vehicle()])
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('mounts the compliance banner when a fleet vehicle is non-compliant (#916 §5.5)', () => {
    renderDashboard([vehicle({ shakenExpiryDate: '2020-01-01' }), vehicle({ id: 'ok' })])
    expect(screen.getByRole('status')).toHaveTextContent('1 vehicle needs attention')
  })

  it('omits the compliance banner when the whole fleet is compliant', () => {
    renderDashboard([vehicle()])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
