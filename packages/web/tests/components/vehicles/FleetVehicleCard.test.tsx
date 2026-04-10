import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      editVehicle: 'Edit',
      retireVehicle: 'Retire',
      'status.AVAILABLE': 'Available',
      'status.MAINTENANCE': 'Maintenance',
      'status.RETIRED': 'Retired',
    }
    return messages[key] ?? key
  },
}))

import { FleetVehicleCard } from '@/components/vehicles/FleetVehicleCard'
import type { VehicleData } from '@/lib/vehicle-api'

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
    render(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    const img = screen.getByRole('img', { name: 'Toyota Corolla' })
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg')
  })

  it('does not crash when photos is undefined', () => {
    const vehicle = makeVehicle({
      photos: undefined as unknown as string[],
    })

    expect(() =>
      render(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />),
    ).not.toThrow()

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not crash when photos is an empty array', () => {
    const vehicle = makeVehicle({ photos: [] })

    expect(() =>
      render(<FleetVehicleCard vehicle={vehicle} onEdit={vi.fn()} onRetire={vi.fn()} />),
    ).not.toThrow()

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
