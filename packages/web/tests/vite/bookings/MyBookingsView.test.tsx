import { MyBookingsView } from '@/vite/bookings/MyBookingsView'
import type { MyBookingRow } from '@/vite/bookings/api'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The view renders typed <Link>s (each row -> confirmation, empty-state CTA ->
// search); stub the router so we assert the destination + search params, not the
// portal/router internals.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: { threadId?: string }
    search?: { bookingId?: string }
    children: ReactNode
  }) => (
    <a data-to={to} data-booking-id={search?.bookingId} data-thread={params?.threadId} href={to}>
      {children}
    </a>
  ),
}))

function makeRow(over: Partial<MyBookingRow> = {}): MyBookingRow {
  return {
    id: 'bk-1',
    bookingCode: 'ABCD2345',
    status: 'CONFIRMED',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    totalPrice: 24000,
    vehicleName: 'Toyota Aqua',
    ...over,
  }
}

function renderView(bookings: MyBookingRow[], threadIdByBooking: Record<string, string> = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <MyBookingsView bookings={bookings} locale="en" threadIdByBooking={threadIdByBooking} />
    </IntlProvider>,
  )
}

describe('MyBookingsView', () => {
  it('renders one row per booking with code, vehicle name, status, range, and total', () => {
    renderView([makeRow()])

    const row = screen.getByRole('listitem')
    expect(within(row).getByText('ABCD2345')).toBeInTheDocument()
    expect(within(row).getByText('Toyota Aqua')).toBeInTheDocument()
    expect(within(row).getByText('Confirmed')).toBeInTheDocument()
    expect(within(row).getByText('￥24,000')).toBeInTheDocument()
    // medium dateStyle, Asia/Tokyo: 01:00Z -> Jul 1; 03 Jul 01:00Z -> Jul 3
    expect(within(row).getByText(/Jul 1, 2026.*Jul 3, 2026/)).toBeInTheDocument()
  })

  it('links each row to its confirmation page carrying the bookingId', () => {
    renderView([makeRow({ id: 'bk-9' })])
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('data-to', '/$locale/bookings/confirmation')
    expect(link).toHaveAttribute('data-booking-id', 'bk-9')
  })

  // #1032: a row whose booking has a messaging thread gets a "Message host" deep
  // link to that conversation; rows without one don't.
  it('shows a Message host link to the thread on a row whose booking has one', () => {
    renderView([makeRow({ id: 'bk-9' })], { 'bk-9': 'th-9' })
    const link = screen.getByRole('link', { name: en.messaging.entry.messageHost })
    expect(link).toHaveAttribute('data-to', '/$locale/messages/$threadId')
    expect(link).toHaveAttribute('data-thread', 'th-9')
  })

  it('omits the Message host link when the booking has no thread', () => {
    renderView([makeRow({ id: 'bk-9' })], {})
    expect(
      screen.queryByRole('link', { name: en.messaging.entry.messageHost }),
    ).not.toBeInTheDocument()
  })

  it('renders the per-status label for a cancelled booking', () => {
    renderView([makeRow({ status: 'CANCELLED' })])
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('shows a friendly empty state with a Browse-cars CTA to search when there are none', () => {
    renderView([])
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText("You haven't made any bookings yet.")).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Browse cars' })
    expect(cta).toHaveAttribute('data-to', '/$locale/search')
  })
})
