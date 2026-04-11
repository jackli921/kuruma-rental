import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      editVehicle: 'Edit',
      retireVehicle: 'Retire',
      'status.AVAILABLE': 'Available',
      'status.MAINTENANCE': 'Maintenance',
      'status.RETIRED': 'Retired',
      'statusToggle.restore': 'Restore',
      'statusToggle.error': 'Could not update status. Please try again.',
      'statusToggle.ariaLabel': 'Change status',
      'form.perDaySuffix': '/day',
      'form.perHourSuffix': '/hr',
    }
    return messages[key] ?? key
  },
}))

import { FleetVehicleCard } from '@/components/vehicles/FleetVehicleCard'
import type { VehicleData } from '@/lib/vehicle-api'

// Wrap in a QueryClientProvider because the embedded VehicleStatusToggle
// uses React Query hooks (issue #51).
function renderCard(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function makeVehicle(overrides: Partial<VehicleData> = {}): VehicleData {
  return {
    id: 'v_1',
    name: 'Toyota Corolla',
    description: null,
    photos: ['https://example.com/photo.jpg'],
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('FleetVehicleCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders vehicle name and photo when photos exist', () => {
    const vehicle = makeVehicle()
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    const img = screen.getByRole('img', { name: 'Toyota Corolla' })
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg')
  })

  it('does not crash when photos is undefined', () => {
    const vehicle = makeVehicle({
      photos: undefined as unknown as string[],
    })

    expect(() =>
      renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />),
    ).not.toThrow()

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not crash when photos is an empty array', () => {
    const vehicle = makeVehicle({ photos: [] })

    expect(() =>
      renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />),
    ).not.toThrow()

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  // Pricing display (#48)
  it('renders the daily rate when only daily is set', () => {
    const vehicle = makeVehicle({ dailyRateJpy: 8000, hourlyRateJpy: null })
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    // Intl uses the full-width yen sign in Japanese currency formatting.
    expect(screen.getByText(/8,000\/day/)).toBeInTheDocument()
  })

  it('renders the hourly rate when only hourly is set', () => {
    const vehicle = makeVehicle({ dailyRateJpy: null, hourlyRateJpy: 1200 })
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText(/1,200\/hr/)).toBeInTheDocument()
  })

  it('renders both rates separated by a middle dot when both are set', () => {
    const vehicle = makeVehicle({ dailyRateJpy: 8000, hourlyRateJpy: 1200 })
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText(/8,000\/day · .*1,200\/hr/)).toBeInTheDocument()
  })

  // Issue #51
  it('renders the inline status toggle (not just a static badge)', () => {
    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    // The segmented control exposes both options with current pressed.
    const toggleGroup = screen.getByRole('group', { name: 'Change status' })
    expect(toggleGroup).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Available' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('omits the price row when both rates are null (defensive)', () => {
    // Shouldn't happen post-#48 — the DB CHECK constraint prevents it —
    // but if stale cache or a migration edge case produces such a row,
    // the card must not render an empty price line.
    const vehicle = makeVehicle({ dailyRateJpy: null, hourlyRateJpy: null })
    renderCard(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.queryByText(/\/day|\/hr/)).not.toBeInTheDocument()
  })
})
