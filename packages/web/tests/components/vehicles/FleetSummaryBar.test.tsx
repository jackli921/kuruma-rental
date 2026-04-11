// Top summary bar that tells the owner at a glance how many cars exist
// and how they break down: total · on rental · available · maintenance.
// "On rental" means there is a currentBooking — reflects operational
// state, not the database `status` field which could still be AVAILABLE
// while a rental is in progress. See issue #52.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'fleet.summary.total': '{n} cars',
      'fleet.summary.onRental': '{n} on rental',
      'fleet.summary.available': '{n} available',
      'fleet.summary.maintenance': '{n} maintenance',
    }
    const template = messages[key] ?? key
    if (!values) return template
    return Object.entries(values).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      template,
    )
  },
}))

import { FleetSummaryBar } from '@/components/vehicles/FleetSummaryBar'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'

function makeOverview(overrides: Partial<FleetVehicleOverviewData> = {}): FleetVehicleOverviewData {
  return {
    id: crypto.randomUUID(),
    name: 'Car',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    ...overrides,
  }
}

describe('FleetSummaryBar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders zeros for an empty list', () => {
    render(<FleetSummaryBar overviews={[]} />)

    expect(screen.getByText('0 cars')).toBeInTheDocument()
    expect(screen.getByText('0 on rental')).toBeInTheDocument()
    expect(screen.getByText('0 available')).toBeInTheDocument()
    expect(screen.getByText('0 maintenance')).toBeInTheDocument()
  })

  it('counts total cars regardless of status', () => {
    const overviews = [
      makeOverview({ status: 'AVAILABLE' }),
      makeOverview({ status: 'MAINTENANCE' }),
      makeOverview({ status: 'RETIRED' }),
    ]

    render(<FleetSummaryBar overviews={overviews} />)

    expect(screen.getByText('3 cars')).toBeInTheDocument()
  })

  it('counts on-rental by currentBooking presence, not by status field', () => {
    const overviews = [
      // Database status AVAILABLE but a rental is actively in progress.
      makeOverview({
        status: 'AVAILABLE',
        currentBooking: {
          startAt: '2026-04-11T09:00:00Z',
          endAt: '2026-04-11T18:00:00Z',
          renterName: null,
        },
      }),
      // AVAILABLE without a current booking — not on rental.
      makeOverview({ status: 'AVAILABLE' }),
      // MAINTENANCE — not on rental regardless of booking state.
      makeOverview({ status: 'MAINTENANCE' }),
    ]

    render(<FleetSummaryBar overviews={overviews} />)

    expect(screen.getByText('1 on rental')).toBeInTheDocument()
  })

  it('counts available using the db status field', () => {
    const overviews = [
      makeOverview({ status: 'AVAILABLE' }),
      makeOverview({ status: 'AVAILABLE' }),
      makeOverview({ status: 'MAINTENANCE' }),
      makeOverview({ status: 'RETIRED' }),
    ]

    render(<FleetSummaryBar overviews={overviews} />)

    expect(screen.getByText('2 available')).toBeInTheDocument()
  })

  it('counts maintenance using the db status field', () => {
    const overviews = [
      makeOverview({ status: 'MAINTENANCE' }),
      makeOverview({ status: 'MAINTENANCE' }),
      makeOverview({ status: 'AVAILABLE' }),
    ]

    render(<FleetSummaryBar overviews={overviews} />)

    expect(screen.getByText('2 maintenance')).toBeInTheDocument()
  })
})
