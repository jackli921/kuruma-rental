import { BookingDetailDialog } from '@/components/calendar/BookingDetailDialog'
import type { CalendarBooking } from '@/lib/calendar'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/routing', () => ({
  Link: ({
    href,
    children,
    onClick,
    className,
  }: {
    href: string
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const m: Record<string, string> = {
      bookingDetails: 'Booking Details',
      status: 'Status',
      start: 'Start',
      end: 'End',
      source: 'Source',
      notes: 'Notes',
      close: 'Close',
      email: 'Email',
      language: 'Language',
      totalPrice: 'Total price',
      startTrip: 'Start trip',
      cancelBooking: 'Cancel booking',
      viewFullDetails: 'View full details',
      back: 'Back',
    }
    return m[key] ?? key
  },
}))

vi.mock('@/components/calendar/calendar-actions', () => ({
  updateBookingStatus: vi.fn(),
  cancelBooking: vi.fn(),
}))

const booking: CalendarBooking = {
  id: 'bk_abc123',
  renterId: 'u1',
  vehicleId: 'v1',
  startAt: new Date('2026-05-01T10:00:00Z').toISOString(),
  endAt: new Date('2026-05-02T10:00:00Z').toISOString(),
  effectiveEndAt: new Date('2026-05-02T11:00:00Z').toISOString(),
  status: 'CONFIRMED',
  source: 'DIRECT',
  renterName: 'Alice',
  renterEmail: 'alice@example.com',
  renterLanguage: null,
  totalPrice: 10000,
  notes: null,
}

afterEach(() => cleanup())

describe('BookingDetailDialog — View full details link', () => {
  it('renders a link to /manage/bookings/:id pointing at the booking', () => {
    render(<BookingDetailDialog booking={booking} onClose={() => {}} />)
    const link = screen.getByRole('link', { name: /view full details/i })
    expect(link).toHaveAttribute('href', '/manage/bookings/bk_abc123')
  })

  it('calls onClose when the link is clicked', () => {
    const onClose = vi.fn()
    render(<BookingDetailDialog booking={booking} onClose={onClose} />)
    const link = screen.getByRole('link', { name: /view full details/i })
    link.click()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
