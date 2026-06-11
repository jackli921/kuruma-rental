import { formatDateTime, formatJpy } from '@/lib/format'
import { BookingConfirmationView } from '@/vite/bookings/BookingConfirmationView'
import type { BookingDto } from '@/vite/bookings/api'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string
    params?: { locale?: string }
    children: ReactNode
  }) => (
    <a href={to} data-to={to} data-locale={params?.locale}>
      {children}
    </a>
  ),
}))

const START = '2026-07-01T01:00:00.000Z'
const END = '2026-07-03T01:00:00.000Z'

function makeBooking(overrides: Partial<BookingDto> = {}): BookingDto {
  return {
    id: 'b-1',
    bookingCode: 'ABCD1234',
    renterId: 'r1',
    classId: 'c1',
    requestedVehicleId: 'v1',
    assignedVehicleId: 'v1',
    pickupLocationId: 'loc1',
    dropoffLocationId: 'loc1',
    startAt: START,
    endAt: END,
    effectiveEndAt: END,
    status: 'CONFIRMED',
    source: 'DIRECT',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 20000,
    notes: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderView(booking: BookingDto, vehicleClass: VehicleClassData | null = null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <BookingConfirmationView booking={booking} vehicleClass={vehicleClass} />
    </IntlProvider>,
  )
}

describe('BookingConfirmationView', () => {
  it('shows the reservation code, pickup/return datetimes and confirmed status', () => {
    renderView(makeBooking())
    expect(screen.getByText('ABCD1234')).toBeInTheDocument()
    expect(screen.getByText(formatDateTime(START, 'en'))).toBeInTheDocument()
    expect(screen.getByText(formatDateTime(END, 'en'))).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
  })

  it('shows the resolved vehicle class label', () => {
    renderView(makeBooking(), { name: 'Compact' } as VehicleClassData)
    expect(screen.getByText('Class')).toBeInTheDocument()
    expect(screen.getByText('Compact')).toBeInTheDocument()
  })

  it('omits the class row when no class is resolved', () => {
    renderView(makeBooking(), null)
    expect(screen.queryByText('Class')).not.toBeInTheDocument()
  })

  it('renders the selected insurance with its daily price', () => {
    renderView(makeBooking({ insuranceSnapshot: { name: 'Basic', dailyPriceJpy: 1500 } as never }))
    expect(screen.getByText(`Basic · ${formatJpy(1500)}/ day`)).toBeInTheDocument()
  })

  it('shows Declined when the renter took no insurance', () => {
    renderView(makeBooking({ insuranceSnapshot: null }))
    expect(screen.getByText('Declined')).toBeInTheDocument()
  })

  it('hides the potential-charges block when the fee snapshot is empty', () => {
    renderView(makeBooking({ feeSnapshot: [] }))
    expect(screen.queryByText('Potential additional charges')).not.toBeInTheDocument()
  })

  it('lists each potential charge when the fee snapshot is non-empty', () => {
    renderView(
      makeBooking({
        feeSnapshot: [
          { feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 500, vehicleClassId: null },
        ] as never,
      }),
    )
    expect(screen.getByText('Potential additional charges')).toBeInTheDocument()
    expect(screen.getByText('Overtime')).toBeInTheDocument()
    expect(screen.getByText(`${formatJpy(500)} per hour`)).toBeInTheDocument()
  })

  it('renders the operator pre-auth handoff link when present', () => {
    renderView(
      makeBooking({
        operator: { name: 'Best Car Rental', preAuthHandoffUrl: 'https://op/preauth' },
      }),
    )
    expect(screen.getByRole('link', { name: /Complete pre-authorization/ })).toHaveAttribute(
      'href',
      'https://op/preauth',
    )
  })

  it('hides the pre-auth handoff card when the operator has no URL', () => {
    renderView(makeBooking({ operator: { name: 'Best Car Rental', preAuthHandoffUrl: null } }))
    expect(
      screen.queryByRole('link', { name: /Complete pre-authorization/ }),
    ).not.toBeInTheDocument()
  })

  it('links back to my bookings and to the catalog', () => {
    renderView(makeBooking())
    expect(screen.getByText('View my bookings').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/bookings',
    )
    expect(screen.getByText('Browse more vehicles').closest('a')).toHaveAttribute(
      'data-to',
      '/$locale/vehicles',
    )
  })
})
