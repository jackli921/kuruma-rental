import { OperatorBookingsView } from '@/vite/operator-bookings/OperatorBookingsView'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The code cell is now a typed router Link to the trip-detail page (#549). Mock
// it to a plain anchor so the presentational table renders without a router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string; bookingId?: string }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-booking-id={params?.bookingId}
      {...rest}
    >
      {children}
    </a>
  ),
}))

function makeRow(over: Partial<OperatorBookingRow> = {}): OperatorBookingRow {
  return {
    id: 'bk-1',
    bookingCode: 'ABCD2345',
    status: 'CONFIRMED',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    totalPrice: 24000,
    vehicleName: 'Toyota Aqua',
    renter: { id: 'r-1', name: 'Jane Renter', email: 'jane@example.com' },
    ...over,
  }
}

function renderView(bookings: OperatorBookingRow[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <OperatorBookingsView bookings={bookings} locale="en" />
    </IntlProvider>,
  )
}

describe('OperatorBookingsView', () => {
  it('renders one row per booking with code, vehicle, renter, status, and total', () => {
    renderView([makeRow()])

    const row = screen.getByRole('row', { name: /ABCD2345/ })
    expect(within(row).getByText('ABCD2345')).toBeInTheDocument()
    expect(within(row).getByText('Toyota Aqua')).toBeInTheDocument()
    expect(within(row).getByText('Jane Renter')).toBeInTheDocument()
    expect(within(row).getByText('Confirmed')).toBeInTheDocument()
    expect(within(row).getByText('￥24,000')).toBeInTheDocument()
  })

  it('renders the JST date range for a booking', () => {
    renderView([makeRow()])
    const row = screen.getByRole('row', { name: /ABCD2345/ })
    // medium dateStyle, Asia/Tokyo: 01:00Z -> Jul 1; 03 Jul 01:00Z -> Jul 3
    expect(within(row).getByText(/Jul 1, 2026.*Jul 3, 2026/)).toBeInTheDocument()
  })

  it('falls back to the renter email when the name is null', () => {
    renderView([makeRow({ renter: { id: 'r-1', name: null, email: 'noname@example.com' } })])
    expect(screen.getByText('noname@example.com')).toBeInTheDocument()
  })

  it('shows a dash for a missing vehicle, renter, and total', () => {
    renderView([makeRow({ vehicleName: null, renter: null, totalPrice: null })])
    const row = screen.getByRole('row', { name: /ABCD2345/ })
    expect(within(row).getAllByText('—')).toHaveLength(3)
  })

  it('renders the per-status label for each booking status', () => {
    renderView([makeRow({ status: 'CANCELLED', bookingCode: 'CXLD0001' })])
    const row = screen.getByRole('row', { name: /CXLD0001/ })
    expect(within(row).getByText('Cancelled')).toBeInTheDocument()
  })

  it('renders an empty state when there are no bookings', () => {
    renderView([])
    expect(screen.getByText('No bookings yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('links each booking code to its locale-scoped trip detail page', () => {
    renderView([makeRow()])

    const link = screen.getByRole('link', { name: /View details for booking ABCD2345/ })
    expect(link).toHaveAttribute('data-to', '/$locale/manage/bookings/$bookingId')
    expect(link).toHaveAttribute('data-locale', 'en')
    expect(link).toHaveAttribute('data-booking-id', 'bk-1')
  })
})
