import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'group.unassigned': 'Unassigned',
      'group.vehicleCount': `${values?.count ?? 0} vehicles`,
    }
    return messages[key] ?? key
  },
}))

import { FleetGroupedList } from '@/components/vehicles/FleetGroupedList'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import type { VehicleClassData } from '@/modules/classes'

const CLASS_A: VehicleClassData = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  transmission: 'AUTO',
  fuelType: null,
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const CLASS_B: VehicleClassData = {
  ...CLASS_A,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'SUV',
  slug: 'suv',
  sortOrder: 1,
}

function makeVehicle(overrides: Partial<FleetVehicleOverviewData>): FleetVehicleOverviewData {
  return {
    id: 'v-id',
    name: 'Vehicle',
    description: null,
    make: null,
    model: null,
    year: null,
    color: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    bufferMinutes: 60,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    status: 'AVAILABLE',
    classId: null,
    photos: [],
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

describe('FleetGroupedList', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders one section per non-empty class group with count', () => {
    const v1 = makeVehicle({ id: 'v1', name: 'Compact A', classId: CLASS_A.id })
    const v2 = makeVehicle({ id: 'v2', name: 'SUV A', classId: CLASS_B.id })
    const v3 = makeVehicle({ id: 'v3', name: 'Compact B', classId: CLASS_A.id })

    render(
      <FleetGroupedList
        vehicles={[v1, v2, v3]}
        classes={[CLASS_A, CLASS_B]}
        renderVehicle={(v) => <div key={v.id}>{v.name}</div>}
      />,
    )

    expect(screen.getByRole('heading', { name: /Compact/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /SUV/ })).toBeInTheDocument()
    expect(screen.getByText('Compact A')).toBeInTheDocument()
    expect(screen.getByText('SUV A')).toBeInTheDocument()
    expect(screen.getByText('Compact B')).toBeInTheDocument()
  })

  it('renders an Unassigned section for vehicles with null classId', () => {
    const orphan = makeVehicle({ id: 'v1', name: 'Orphan', classId: null })
    render(
      <FleetGroupedList
        vehicles={[orphan]}
        classes={[CLASS_A]}
        renderVehicle={(v) => <div key={v.id}>{v.name}</div>}
      />,
    )

    expect(screen.getByRole('heading', { name: /Unassigned/ })).toBeInTheDocument()
    expect(screen.getByText('Orphan')).toBeInTheDocument()
  })

  it('collapses and expands a class section when header is clicked', () => {
    const v1 = makeVehicle({ id: 'v1', name: 'Compact A', classId: CLASS_A.id })
    render(
      <FleetGroupedList
        vehicles={[v1]}
        classes={[CLASS_A]}
        renderVehicle={(v) => <div key={v.id}>{v.name}</div>}
      />,
    )

    const header = screen.getByRole('button', { name: /Compact/ })
    expect(screen.getByText('Compact A')).toBeVisible()

    fireEvent.click(header)
    expect(screen.queryByText('Compact A')).not.toBeInTheDocument()

    fireEvent.click(header)
    expect(screen.getByText('Compact A')).toBeVisible()
  })

  it('renders nothing when there are no vehicles', () => {
    const { container } = render(
      <FleetGroupedList
        vehicles={[]}
        classes={[CLASS_A]}
        renderVehicle={(v) => <div key={v.id}>{v.name}</div>}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
