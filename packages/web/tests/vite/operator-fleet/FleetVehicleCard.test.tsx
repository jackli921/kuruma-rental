import { FleetVehicleCard } from '@/vite/operator-fleet/FleetVehicleCard'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

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
    insuranceExpiryDate: null,
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

// canWrite={false} drops the checkbox + FleetRowActions (which needs a QueryClient),
// leaving the thumbnail to render on its own.
function renderCard(v: OperatorFleetVehicle) {
  return render(
    <IntlProvider locale="en" messages={enMessages}>
      <FleetVehicleCard
        vehicle={v}
        selected={false}
        onToggleSelect={vi.fn()}
        onEdit={vi.fn()}
        canWrite={false}
        todayIso="2026-01-01"
        locale="en"
      />
    </IntlProvider>,
  )
}

describe('FleetVehicleCard', () => {
  it('gives the thumbnail explicit 3:2 dimensions when a photo is present', () => {
    renderCard(vehicle({ name: 'Toyota Aqua', photos: ['https://cdn.example/aqua.jpg'] }))
    const img = screen.getByRole('img', { name: 'Toyota Aqua' })
    expect(img).toHaveAttribute('width', '300')
    expect(img).toHaveAttribute('height', '200')
  })
})
