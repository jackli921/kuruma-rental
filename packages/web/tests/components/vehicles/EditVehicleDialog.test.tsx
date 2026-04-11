// Regression test for issue #60: EditVehicleDialog must pre-populate the
// pricing fields from the selected vehicle. PR #59 (fleet pricing slice)
// added the rate inputs to VehicleForm but forgot to include them in the
// dialog's explicit defaultValues whitelist, so the inputs rendered empty
// and any save attempt hit the validator's "at least one rate required"
// rule.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      editVehicle: 'Edit vehicle',
      'form.name': 'Vehicle name',
      'form.namePlaceholder': 'e.g. Toyota Corolla 2024',
      'form.description': 'Description',
      'form.descriptionPlaceholder': 'Brief description',
      'form.seats': 'Seats',
      'form.transmission': 'Transmission',
      'form.transmissionAuto': 'Automatic',
      'form.transmissionManual': 'Manual',
      'form.fuelType': 'Fuel type',
      'form.fuelTypePlaceholder': 'e.g. Gasoline',
      'form.bufferMinutes': 'Buffer time (minutes)',
      'form.pricingHeading': 'Pricing (JPY)',
      'form.pricingHint': 'At least one rate is required.',
      'form.dailyRate': 'Daily rate',
      'form.hourlyRate': 'Hourly rate',
      'form.save': 'Save vehicle',
      'form.saving': 'Saving...',
      'form.cancel': 'Cancel',
    }
    return messages[key] ?? key
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/vehicle-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vehicle-api')>('@/lib/vehicle-api')
  return {
    ...actual,
    updateVehicle: vi.fn().mockResolvedValue(undefined),
  }
})

import { EditVehicleDialog } from '@/components/vehicles/EditVehicleDialog'
import type { VehicleData } from '@/lib/vehicle-api'

function makeVehicle(overrides: Partial<VehicleData> = {}): VehicleData {
  return {
    id: 'v_1',
    name: 'Daihatsu Tanto',
    description: 'Ultra-practical kei car',
    photos: [],
    seats: 4,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('EditVehicleDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('pre-populates the daily rate and hourly rate from the vehicle prop', () => {
    const vehicle = makeVehicle({ dailyRateJpy: 6500, hourlyRateJpy: 900 })
    render(<EditVehicleDialog vehicle={vehicle} onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Daily rate')).toHaveValue(6500)
    expect(screen.getByLabelText('Hourly rate')).toHaveValue(900)
  })

  it('pre-populates only the daily rate when hourly is null', () => {
    const vehicle = makeVehicle({ dailyRateJpy: 8000, hourlyRateJpy: null })
    render(<EditVehicleDialog vehicle={vehicle} onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Daily rate')).toHaveValue(8000)
    expect(screen.getByLabelText('Hourly rate')).not.toHaveValue()
  })

  it('pre-populates only the hourly rate when daily is null', () => {
    const vehicle = makeVehicle({ dailyRateJpy: null, hourlyRateJpy: 1200 })
    render(<EditVehicleDialog vehicle={vehicle} onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Daily rate')).not.toHaveValue()
    expect(screen.getByLabelText('Hourly rate')).toHaveValue(1200)
  })

  it('also pre-populates the already-working fields (sanity check)', () => {
    const vehicle = makeVehicle({
      name: 'Honda N-BOX',
      seats: 4,
      bufferMinutes: 45,
      dailyRateJpy: 6500,
      hourlyRateJpy: 900,
    })
    render(<EditVehicleDialog vehicle={vehicle} onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('Vehicle name')).toHaveValue('Honda N-BOX')
    expect(screen.getByLabelText('Seats')).toHaveValue(4)
    expect(screen.getByLabelText('Buffer time (minutes)')).toHaveValue(45)
  })

  it('renders nothing when vehicle is null', () => {
    render(<EditVehicleDialog vehicle={null} onOpenChange={vi.fn()} />)
    expect(screen.queryByLabelText('Daily rate')).not.toBeInTheDocument()
  })
})
