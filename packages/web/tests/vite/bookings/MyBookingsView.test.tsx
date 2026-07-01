import { MyBookingsView } from '@/vite/bookings/MyBookingsView'
import type { MyBookingRow } from '@/vite/bookings/api'
import type { Session } from '@/vite/session'
import { sessionQueryOptions } from '@/vite/session'
import type { ReviewSubject } from '@kuruma/shared/enums'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const SESSION: Session = { user: { id: 'renter-1', role: 'RENTER' }, csrfToken: 'csrf-1' }

function renderView(
  bookings: MyBookingRow[],
  threadIdByBooking: Record<string, string> = {},
  reviewedSubjectsByBooking: Record<string, readonly ReviewSubject[]> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(sessionQueryOptions().queryKey, SESSION)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <MyBookingsView
          bookings={bookings}
          locale="en"
          threadIdByBooking={threadIdByBooking}
          reviewedSubjectsByBooking={reviewedSubjectsByBooking}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('MyBookingsView', () => {
  // Reviews ships OFF for the beta MVP; the post-trip prompt only shows where the flag is on.
  beforeEach(() => vi.stubEnv('VITE_FEATURE_REVIEWS', 'true'))
  afterEach(() => vi.unstubAllEnvs())

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

  // #1083: the post-trip review prompt shows on a COMPLETED booking the renter
  // hasn't fully reviewed, and stays hidden otherwise.
  it('shows the review prompt on a COMPLETED booking with subjects still unreviewed', () => {
    renderView([makeRow({ id: 'bk-9', status: 'COMPLETED' })], {}, { 'bk-9': [] })
    expect(screen.getByRole('button', { name: en.reviews.prompt.cta })).toBeInTheDocument()
  })

  it('hides the review prompt once both subjects on a COMPLETED booking are reviewed', () => {
    renderView(
      [makeRow({ id: 'bk-9', status: 'COMPLETED' })],
      {},
      { 'bk-9': ['OPERATOR', 'VEHICLE'] },
    )
    expect(screen.queryByRole('button', { name: en.reviews.prompt.cta })).not.toBeInTheDocument()
  })

  it('never shows the review prompt on a non-COMPLETED booking', () => {
    renderView([makeRow({ id: 'bk-9', status: 'CONFIRMED' })], {}, { 'bk-9': [] })
    expect(screen.queryByRole('button', { name: en.reviews.prompt.cta })).not.toBeInTheDocument()
  })

  it('never shows the review prompt when the reviews feature is gated off (#1083-1086)', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', undefined)
    renderView([makeRow({ id: 'bk-9', status: 'COMPLETED' })], {}, { 'bk-9': [] })
    expect(screen.queryByRole('button', { name: en.reviews.prompt.cta })).not.toBeInTheDocument()
  })

  it('shows a friendly empty state with a Browse-cars CTA to search when there are none', () => {
    renderView([])
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText("You haven't made any bookings yet.")).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Browse cars' })
    expect(cta).toHaveAttribute('data-to', '/$locale/search')
  })
})
