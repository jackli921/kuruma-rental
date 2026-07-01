import { AvailableVehicleCard } from '@/vite/storefronts/AvailableVehicleCard'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { renderWithUsdIndicative } from '../../support/currency'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    className,
    children,
  }: {
    to: string
    params?: { locale?: string }
    search?: { vehicleId?: string; locationId?: string; from?: string; to?: string }
    className?: string
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
      className={className}
    >
      {children}
    </a>
  ),
}))

function makeVehicle(overrides: Partial<AvailableVehicleData> = {}): AvailableVehicleData {
  return {
    id: 'v1',
    classId: 'cls-compact',
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
    luggageCapacity: null,
    luggageSize: null,
    photos: [],
    ...overrides,
  }
}

function renderCard(
  vehicle: AvailableVehicleData = makeVehicle(),
  extra: { classRating?: { avg: number; count: number } | null } = {},
) {
  render(
    <IntlProvider locale="en" messages={en}>
      <AvailableVehicleCard
        vehicle={vehicle}
        locationId="loc-1"
        from="2026-07-01T10:00"
        to="2026-07-03T10:00"
        {...extra}
      />
    </IntlProvider>,
  )
}

describe('AvailableVehicleCard', () => {
  // Reviews ships OFF for the beta MVP; the class-rating badge only renders where the flag is on.
  beforeEach(() => vi.stubEnv('VITE_FEATURE_REVIEWS', 'true'))
  afterEach(() => vi.unstubAllEnvs())

  it('renders no class badge at all when the reviews feature is gated off (#1083-1086)', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', undefined)
    renderCard(makeVehicle(), { classRating: { avg: 4.2, count: 8 } })
    expect(screen.queryByText('★ 4.2 (8)')).toBeNull()
    expect(screen.queryByTestId('rating-badge-skeleton')).toBeNull()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
  })

  it('renders the vehicle name, seats, transmission, and daily price', () => {
    renderCard()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('From ¥8,000 / day')).toBeInTheDocument()
  })

  it('links the booking CTA to the wizard carrying vehicle, location, and dates', () => {
    renderCard()
    const book = screen.getByRole('link', { name: 'Book this car' })
    expect(book).toHaveAttribute('data-to', '/$locale/bookings/new')
    expect(book).toHaveAttribute('data-locale', 'en')
    expect(book).toHaveAttribute('data-vehicle', 'v1')
    expect(book).toHaveAttribute('data-location', 'loc-1')
    expect(book).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(book).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })

  // #457: effective luggage (vehicle override resolved against the class default).
  it('shows the resolved luggage count and size when both are present', () => {
    renderCard(makeVehicle({ luggageCapacity: 4, luggageSize: 'LARGE' }))
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  it('shows the count alone when the resolved size is null', () => {
    renderCard(makeVehicle({ luggageCapacity: 4, luggageSize: null }))
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.queryByText(/Large/)).toBeNull()
  })

  it('renders no luggage line when capacity is unknown (classless, no override)', () => {
    renderCard(makeVehicle({ luggageCapacity: null, luggageSize: null }))
    expect(screen.queryByText(/bags/)).toBeNull()
  })

  it('renders a singular bag label when capacity is one', () => {
    renderCard(makeVehicle({ luggageCapacity: 1, luggageSize: 'SMALL' }))
    expect(screen.getByText('1 bag')).toBeInTheDocument()
  })

  it('converts the from-price for the indicative note', async () => {
    renderWithUsdIndicative(
      <AvailableVehicleCard
        vehicle={makeVehicle({ dailyRateJpy: 30000 })}
        locationId="loc-1"
        from="2026-07-01T10:00"
        to="2026-07-03T10:00"
      />,
    )
    expect(await screen.findByText(/≈ \$201/)).toBeTruthy()
  })

  it('renders a skeleton class-rating badge while the parent batch is in flight (#1085)', () => {
    renderCard()
    expect(screen.getByTestId('rating-badge-skeleton')).toBeInTheDocument()
  })

  it('renders the class rating once the batch resolves (#1085)', () => {
    renderCard(makeVehicle(), { classRating: { avg: 4.2, count: 8 } })
    expect(screen.getByText('★ 4.2 (8)')).toBeInTheDocument()
    expect(screen.getByLabelText('4.2 stars, 8 reviews')).toBeInTheDocument()
  })

  it('renders no class badge AT ALL when classId is null (#1085 — distinct from rated-zero)', () => {
    renderCard(makeVehicle({ classId: null, classLabel: '' }))
    expect(screen.queryByTestId('rating-badge-skeleton')).toBeNull()
    expect(screen.queryByText(/no reviews/i)).toBeNull()
    expect(screen.queryByLabelText(/stars,/)).toBeNull()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
  })
})
