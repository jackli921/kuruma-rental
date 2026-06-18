import { formatDateTime, formatJpy } from '@/lib/format'
import { BookingConfirmationView } from '@/vite/bookings/BookingConfirmationView'
import type { BookingDto } from '@/vite/bookings/api'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: { locale?: string; locationId?: string }
    search?: Record<string, string>
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-location={params?.locationId}
      data-search={search ? new URLSearchParams(search).toString() : undefined}
    >
      {children}
    </a>
  ),
}))

// #868 cancellation ships behind a feature flag (OFF for the beta MVP demo). These
// tests cover the feature's behaviour, so they enable it; the OFF case is asserted
// in its own test below.
beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_CANCELLATION', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

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

function renderView(
  booking: BookingDto,
  vehicleClass: VehicleClassData | null = null,
  csrfToken: string | null = 'csrf-tok',
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <BookingConfirmationView
          booking={booking}
          vehicleClass={vehicleClass}
          csrfToken={csrfToken}
        />
      </IntlProvider>
    </QueryClientProvider>,
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

  // #964: the confirmation surfaces which rental company the renter booked with,
  // plus a link back to that operator's storefront pre-filled with the booked dates.
  it('shows the rental company name when the booking has an operator', () => {
    renderView(makeBooking({ operator: { name: 'Best Car Rental', preAuthHandoffUrl: null } }))
    expect(screen.getByText('Rental company')).toBeInTheDocument()
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
  })

  it('omits the rental company block when the booking has no operator', () => {
    renderView(makeBooking({ operator: undefined }))
    expect(screen.getByText('ABCD1234')).toBeInTheDocument() // view mounted
    expect(screen.queryByText('Rental company')).not.toBeInTheDocument()
  })

  it('links to the storefront with a JST range the route parser accepts', () => {
    // startAt 00:00Z -> 09:00 JST, endAt 01:30Z -> 10:30 JST (uses endAt, not effectiveEndAt).
    renderView(
      makeBooking({
        operator: { name: 'Best Car Rental', preAuthHandoffUrl: null },
        pickupLocationId: 'loc_kix',
        startAt: '2026-07-01T00:00:00.000Z',
        endAt: '2026-07-03T01:30:00.000Z',
      }),
    )
    const link = screen.getByText('View storefront').closest('a')
    expect(link).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(link).toHaveAttribute('data-location', 'loc_kix')
    const search = new URLSearchParams(link?.getAttribute('data-search') ?? '')
    expect(search.get('from')).toBe('2026-07-01T09:00')
    expect(search.get('to')).toBe('2026-07-03T10:30')
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

  // #856: the renter can self-cancel only a CONFIRMED booking they own, and only
  // when a CSRF token is available to authorize the write.
  it('offers a cancel control for a confirmed booking', () => {
    renderView(makeBooking({ status: 'CONFIRMED' }))
    expect(screen.getByRole('button', { name: en.bookings.cancel.action })).toBeInTheDocument()
  })

  it('hides the cancel control in the beta MVP demo (cancellation feature flag off)', () => {
    vi.stubEnv('VITE_FEATURE_CANCELLATION', undefined)
    renderView(makeBooking({ status: 'CONFIRMED' }))
    expect(
      screen.queryByRole('button', { name: en.bookings.cancel.action }),
    ).not.toBeInTheDocument()
  })

  it('hides the cancel control once the booking is no longer confirmed', () => {
    renderView(makeBooking({ status: 'ACTIVE' }))
    expect(
      screen.queryByRole('button', { name: en.bookings.cancel.action }),
    ).not.toBeInTheDocument()
  })

  it('hides the cancel control when no CSRF token is available', () => {
    renderView(makeBooking({ status: 'CONFIRMED' }), null, null)
    expect(
      screen.queryByRole('button', { name: en.bookings.cancel.action }),
    ).not.toBeInTheDocument()
  })
})
