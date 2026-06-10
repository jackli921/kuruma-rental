import { StorefrontDetailView } from '@/vite/storefronts/StorefrontDetailView'
import type { AvailableVehicleData, StorefrontDetailData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: { locale?: string }
    search?: { vehicleId?: string; locationId?: string; from?: string; to?: string }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-vehicle={search?.vehicleId}
      data-location={search?.locationId}
      data-from={search?.from}
      data-rangeto={search?.to}
    >
      {children}
    </a>
  ),
}))

function makeVehicle(overrides: Partial<AvailableVehicleData> = {}): AvailableVehicleData {
  return {
    id: 'v1',
    name: 'Toyota Aqua',
    make: 'Toyota',
    model: 'Aqua',
    year: 2024,
    seats: 5,
    transmission: 'AUTO',
    acrissCode: null,
    classLabel: 'Compact',
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    photos: [],
    ...overrides,
  }
}

function makeDetail(vehicles: AvailableVehicleData[]): StorefrontDetailData {
  return {
    storefront: {
      locationId: 'loc-1',
      name: 'Best Car Rental Osaka',
      address: '1-2-3 Namba, Osaka',
      operatorName: 'Best Car Rental',
      operatingHours: null,
    },
    vehicles,
    nextCursor: null,
  }
}

function renderDetail(detail: StorefrontDetailData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <StorefrontDetailView detail={detail} from="2026-07-01T10:00" to="2026-07-03T10:00" />
    </IntlProvider>,
  )
}

describe('StorefrontDetailView', () => {
  it('renders the store header and a card per available vehicle', () => {
    renderDetail(makeDetail([makeVehicle(), makeVehicle({ id: 'v2', name: 'Suzuki Jimny' })]))
    expect(screen.getByText('Best Car Rental Osaka')).toBeInTheDocument()
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Available cars')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('Suzuki Jimny')).toBeInTheDocument()
  })

  it('shows the empty-state copy for a known-but-full store', () => {
    renderDetail(makeDetail([]))
    expect(
      screen.getByText('No cars are available at this store for the selected dates.'),
    ).toBeInTheDocument()
  })

  it('links back to search preserving the date range', () => {
    renderDetail(makeDetail([]))
    const back = screen.getByText('Back to search').closest('a')
    expect(back).toHaveAttribute('data-to', '/$locale/search')
    expect(back).toHaveAttribute('data-locale', 'en')
    expect(back).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(back).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })

  it("carries the storefront location and date range into each car's booking CTA", () => {
    renderDetail(makeDetail([makeVehicle()]))
    const book = screen.getByRole('link', { name: 'Book this car' })
    expect(book).toHaveAttribute('data-to', '/$locale/bookings/new')
    expect(book).toHaveAttribute('data-vehicle', 'v1')
    expect(book).toHaveAttribute('data-location', 'loc-1')
    expect(book).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(book).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })
})
