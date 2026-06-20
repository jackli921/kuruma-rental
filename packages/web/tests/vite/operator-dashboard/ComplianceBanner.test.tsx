import { ComplianceBanner } from '@/vite/operator-dashboard/ComplianceBanner'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Stub TanStack's Link as a plain anchor that also surfaces the search object,
// so the test can assert the deep-link target plus the expiringSoon filter it
// carries (the banner must land the operator on the same set it counts).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string }
    search?: Record<string, unknown>
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-search={JSON.stringify(search)}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const copy = enMessages.business.dashboard.compliance

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

function renderBanner(vehicles: OperatorFleetVehicle[]) {
  return render(
    <IntlProvider locale="en" messages={enMessages}>
      <ComplianceBanner vehicles={vehicles} locale="en" />
    </IntlProvider>,
  )
}

describe('ComplianceBanner', () => {
  it('renders nothing when every vehicle is compliant', () => {
    const { container } = renderBanner([vehicle()])
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('counts vehicles whose shaken OR insurance is expired or expiring', () => {
    renderBanner([
      vehicle({ id: 'a', shakenExpiryDate: '2020-01-01' }),
      vehicle({ id: 'b', insuranceExpiryDate: '2020-01-01' }),
      vehicle({ id: 'c' }),
    ])
    expect(screen.getByRole('alert')).toHaveTextContent('2 vehicles need attention')
  })

  it('uses the singular form for exactly one non-compliant vehicle', () => {
    renderBanner([vehicle({ shakenExpiryDate: '2020-01-01' }), vehicle({ id: 'ok' })])
    expect(screen.getByRole('alert')).toHaveTextContent('1 vehicle needs attention')
  })

  it('deep-links to the fleet pre-filtered to the expiring set', () => {
    renderBanner([vehicle({ shakenExpiryDate: '2020-01-01' })])
    const link = screen.getByRole('link', { name: copy.action })
    expect(link).toHaveAttribute('data-to', '/$locale/manage/fleet')
    expect(link).toHaveAttribute('data-locale', 'en')
    expect(link).toHaveAttribute('data-search', JSON.stringify({ expiringSoon: true }))
  })
})
