// Tests for FleetVehicleRow — the dense, information-rich row that
// replaces FleetVehicleCard on the owner-facing /manage/vehicles page
// (issue #52). FleetVehicleCard remains in use on the renter-facing
// /vehicles browse page.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    // Flat mock indexed by fully-qualified keys. next-intl uses a
    // per-namespace API so the literal `key` passed in depends on the
    // namespace the consumer opened. We cover both `business.vehicles.*`
    // keys (FleetVehicleRow) and bare status keys (VehicleStatusBadge
    // which uses `business.vehicles.status` as its namespace).
    const messages: Record<string, string> = {
      editVehicle: 'Edit',
      retireVehicle: 'Retire',
      AVAILABLE: 'Available',
      MAINTENANCE: 'Maintenance',
      RETIRED: 'Retired',
      'form.perDaySuffix': '/day',
      'form.perHourSuffix': '/hr',
      'fleet.onRentalUntil': 'On rental until {time}',
      'fleet.nextBooking': 'Next: {time}',
      'fleet.utilizationLabel': '{percent}% · {count} bookings this month',
      'fleet.noBookings': 'No upcoming bookings',
      'fleet.moreActions': 'More actions',
    }
    const template = messages[key] ?? key
    if (!values) return template
    return Object.entries(values).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      template,
    )
  },
}))

import { FleetVehicleRow } from '@/components/vehicles/FleetVehicleRow'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'

function makeOverview(overrides: Partial<FleetVehicleOverviewData> = {}): FleetVehicleOverviewData {
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
    utilization: 72,
    bookingCountLast30Days: 3,
    currentBooking: null,
    nextBooking: null,
    ...overrides,
  }
}

describe('FleetVehicleRow', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the vehicle name and its first photo as a thumbnail', () => {
    const overview = makeOverview()

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText('Toyota Corolla')).toBeInTheDocument()
    const img = screen.getByRole('img', { name: 'Toyota Corolla' })
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg')
  })

  it('renders the placeholder icon when the vehicle has no photos', () => {
    const overview = makeOverview({ photos: [] })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // Placeholder uses data-testid so screen readers don't see a redundant icon.
    expect(screen.getByTestId('fleet-row-thumbnail-placeholder')).toBeInTheDocument()
  })

  it('renders seats, transmission, and fuel type as a subtitle', () => {
    const overview = makeOverview({ seats: 4, transmission: 'MANUAL', fuelType: 'Diesel' })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    // Subtitle format: "4 · MT · Diesel" (seats · transmission · fuel)
    const subtitle = screen.getByTestId('fleet-row-subtitle')
    expect(subtitle).toHaveTextContent(/4/)
    expect(subtitle).toHaveTextContent(/MT/)
    expect(subtitle).toHaveTextContent(/Diesel/)
  })

  it('renders the daily rate when only daily is set', () => {
    const overview = makeOverview({ dailyRateJpy: 8000, hourlyRateJpy: null })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText(/8,000\/day/)).toBeInTheDocument()
  })

  it('renders the status badge', () => {
    const overview = makeOverview({ status: 'MAINTENANCE' })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByText('Maintenance')).toBeInTheDocument()
  })

  it('renders "On rental until ..." when currentBooking is set', () => {
    const overview = makeOverview({
      currentBooking: {
        startAt: '2026-04-11T09:00:00Z',
        endAt: '2026-04-11T18:00:00Z',
        renterName: 'Alice',
      },
    })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    // The row should mention rental-in-progress. We assert the label text
    // without pinning exact locale formatting, which lives in a helper.
    expect(screen.getByTestId('fleet-row-booking-indicator')).toHaveTextContent(/On rental until/)
  })

  it('renders "Next: ..." when only nextBooking is set', () => {
    const overview = makeOverview({
      nextBooking: {
        startAt: '2026-04-12T10:00:00Z',
        endAt: '2026-04-12T14:00:00Z',
        renterName: null,
      },
    })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByTestId('fleet-row-booking-indicator')).toHaveTextContent(/Next:/)
  })

  it('renders "No upcoming bookings" when neither current nor next is set', () => {
    const overview = makeOverview({ currentBooking: null, nextBooking: null })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    expect(screen.getByTestId('fleet-row-booking-indicator')).toHaveTextContent(
      /No upcoming bookings/,
    )
  })

  it('renders utilization percentage rounded to whole number with booking count', () => {
    const overview = makeOverview({ utilization: 72.4, bookingCountLast30Days: 3 })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    const util = screen.getByTestId('fleet-row-utilization')
    expect(util).toHaveTextContent(/72%/)
    expect(util).toHaveTextContent(/3/)
  })

  it('fires onEdit when the overflow menu Edit action is clicked', async () => {
    const onEdit = vi.fn()
    const overview = makeOverview()

    render(<FleetVehicleRow overview={overview} onEdit={onEdit} onRetire={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(overview)
  })

  it('fires onRetire when the overflow menu Retire action is clicked (non-retired)', async () => {
    const onRetire = vi.fn()
    const overview = makeOverview({ status: 'AVAILABLE' })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={onRetire} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Retire' }))

    expect(onRetire).toHaveBeenCalledTimes(1)
    expect(onRetire).toHaveBeenCalledWith(overview)
  })

  it('hides the Retire action in the overflow menu when the vehicle is already RETIRED', async () => {
    const overview = makeOverview({ status: 'RETIRED' })

    render(<FleetVehicleRow overview={overview} onEdit={vi.fn()} onRetire={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    expect(screen.queryByRole('menuitem', { name: 'Retire' })).not.toBeInTheDocument()
  })
})
