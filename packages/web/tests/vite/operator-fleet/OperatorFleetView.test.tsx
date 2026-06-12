import { formatVehicleRate } from '@/lib/format'
import { OperatorFleetView } from '@/vite/operator-fleet/OperatorFleetView'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.vehicles.fleet
const bulk = enMessages.business.vehicles.bulk
const filter = enMessages.business.vehicles.filter
const statusLabels = enMessages.business.vehicles.status

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

function renderView(vehicles: OperatorFleetVehicle[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorFleetView vehicles={vehicles} locale="en" />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorFleetView', () => {
  it('shows the empty state when there are no vehicles', () => {
    renderView([])
    expect(screen.getByText(en.empty)).toBeInTheDocument()
  })

  it('renders a vehicle row with name, plate, status, seats, luggage and price', () => {
    renderView([vehicle()])
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('なにわ 300 あ 12-34')).toBeInTheDocument()
    expect(screen.getByText(en.status.AVAILABLE)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    const price = formatVehicleRate(6800, null, { perDay: en.perDay, perHour: en.perHour })
    expect(screen.getByText(price as string)).toBeInTheDocument()
  })

  it('flags an expired sha-ken certificate', () => {
    renderView([vehicle({ id: 'v2', shakenExpiryDate: '2020-01-01' })])
    expect(screen.getByText(en.expiry.EXPIRED)).toBeInTheDocument()
  })

  it('shows the maintenance status label for a vehicle under maintenance', () => {
    renderView([vehicle({ id: 'v3', status: 'MAINTENANCE' })])
    expect(screen.getByText(en.status.MAINTENANCE)).toBeInTheDocument()
  })

  it('renders one row per vehicle', () => {
    renderView([vehicle({ id: 'a', name: 'Car A' }), vehicle({ id: 'b', name: 'Car B' })])
    expect(screen.getByText('Car A')).toBeInTheDocument()
    expect(screen.getByText('Car B')).toBeInTheDocument()
  })

  it('reveals the bulk action bar with a count when a row is selected', async () => {
    const user = userEvent.setup()
    renderView([vehicle({ id: 'a', name: 'Car A' }), vehicle({ id: 'b', name: 'Car B' })])

    expect(screen.queryByText('1 vehicle selected')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select Car A' }))

    expect(screen.getByText('1 vehicle selected')).toBeInTheDocument()
  })

  it('select-all checkbox selects every visible row', async () => {
    const user = userEvent.setup()
    renderView([vehicle({ id: 'a', name: 'Car A' }), vehicle({ id: 'b', name: 'Car B' })])

    await user.click(screen.getByRole('checkbox', { name: bulk.selectAll }))

    expect(screen.getByText('2 vehicles selected')).toBeInTheDocument()
  })

  it('deselect-all from the bulk bar clears the selection', async () => {
    const user = userEvent.setup()
    renderView([vehicle({ id: 'a', name: 'Car A' }), vehicle({ id: 'b', name: 'Car B' })])

    await user.click(screen.getByRole('checkbox', { name: bulk.selectAll }))
    await user.click(screen.getByRole('button', { name: bulk.deselectAll }))

    expect(screen.queryByText('2 vehicles selected')).not.toBeInTheDocument()
  })

  it('filters the table to rows matching the search query', async () => {
    const user = userEvent.setup()
    renderView([vehicle({ id: 'a', name: 'Toyota Aqua' }), vehicle({ id: 'b', name: 'Honda Fit' })])
    expect(screen.getByText('Honda Fit')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(filter.searchPlaceholder), 'Aqua')

    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.queryByText('Honda Fit')).not.toBeInTheDocument()
  })

  it('filters the table by status when a status facet is toggled', async () => {
    const user = userEvent.setup()
    renderView([
      vehicle({ id: 'a', name: 'Available Car', status: 'AVAILABLE' }),
      vehicle({ id: 'b', name: 'Retired Car', status: 'RETIRED' }),
    ])

    await user.click(screen.getByRole('button', { name: new RegExp(`^${statusLabels.RETIRED}`) }))

    expect(screen.getByText('Retired Car')).toBeInTheDocument()
    expect(screen.queryByText('Available Car')).not.toBeInTheDocument()
  })
})
