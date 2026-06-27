import { BookingOversightView } from '@/vite/admin/bookings/BookingOversightView'
import type { AdminBookingDto, AdminBookingsResponse } from '@kuruma/shared/types/admin-booking'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// key -> key translations, and a fixed locale, mirroring AnomaliesPanel.test.tsx.
vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

afterEach(() => cleanup())

function dto(over: Partial<AdminBookingDto>): AdminBookingDto {
  return {
    id: crypto.randomUUID(),
    bookingCode: 'ALPHA001',
    status: 'CONFIRMED',
    operatorId: 'op_a',
    operatorName: 'Best Car Rental',
    renterId: 'r_1',
    renterName: 'Alice Tan',
    renterEmail: 'alice@example.com',
    pickupLocationId: 'loc_1',
    dropoffLocationId: 'loc_1',
    startAt: '2026-05-10T01:00:00.000Z',
    endAt: '2026-05-11T01:00:00.000Z',
    effectiveEndAt: '2026-05-11T01:00:00.000Z',
    totalPrice: 12000,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...over,
  }
}

const rowA = dto({
  bookingCode: 'ALPHA001',
  operatorName: 'Best Car Rental',
  renterName: 'Alice Tan',
})
const rowB = dto({
  bookingCode: 'BETA0002',
  operatorId: 'op_b',
  operatorName: 'Aoki Rentals',
  renterId: 'r_2',
  renterName: 'Bob Lee',
  renterEmail: 'bob@example.com',
})

function response(bookings: AdminBookingDto[]): AdminBookingsResponse {
  return { bookings, nextCursor: null }
}

describe('BookingOversightView', () => {
  it('renders the owning operator and customer identity for each row', () => {
    render(
      <BookingOversightView
        response={response([rowA, rowB])}
        filters={{}}
        onApplyFilters={() => {}}
      />,
    )
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Aoki Rentals')).toBeInTheDocument()
    expect(screen.getByText('Alice Tan')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('shows the empty state when no bookings match', () => {
    render(<BookingOversightView response={response([])} filters={{}} onApplyFilters={() => {}} />)
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('clicking an operator name filters by that operatorId', () => {
    const onApplyFilters = vi.fn()
    render(
      <BookingOversightView
        response={response([rowA, rowB])}
        filters={{}}
        onApplyFilters={onApplyFilters}
      />,
    )
    fireEvent.click(screen.getByText('Aoki Rentals'))
    expect(onApplyFilters).toHaveBeenCalledWith({ operatorId: 'op_b' })
  })

  it('submitting the filter bar applies the customer search', () => {
    const onApplyFilters = vi.fn()
    render(
      <BookingOversightView
        response={response([rowA])}
        filters={{}}
        onApplyFilters={onApplyFilters}
      />,
    )
    fireEvent.change(screen.getByLabelText('filterCustomer'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByText('search'))
    expect(onApplyFilters).toHaveBeenCalledWith({ customer: 'bob' })
  })

  it('opens the detail drawer with mapped fields on a booking code click', () => {
    render(
      <BookingOversightView response={response([rowA])} filters={{}} onApplyFilters={() => {}} />,
    )
    // The drawer is closed initially — its field labels are not mounted.
    expect(screen.queryByText('detailEmail')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('ALPHA001'))
    // Now the drawer renders the renter email under its detail label.
    expect(screen.getByText('detailEmail')).toBeInTheDocument()
    const emails = screen.getAllByText('alice@example.com')
    expect(emails.length).toBeGreaterThanOrEqual(1)
  })
})
