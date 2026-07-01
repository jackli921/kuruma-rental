import { formatJpy } from '@/lib/format'
import { BookingQuickView } from '@/vite/operator-bookings/BookingQuickView'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'bk-1',
  title: 'Jane Doe',
  start: new Date('2026-07-01T01:00:00.000Z'), // 10:00 JST
  end: new Date('2026-07-03T02:00:00.000Z'), // 11:00 JST
  resourceId: 'veh-1',
  status: 'ACTIVE',
  bookingCode: 'ABCD2345',
  renterName: 'Jane Doe',
  renterEmail: 'jane@example.com',
  vehicleName: 'Toyota Aqua',
  totalPrice: 24000,
  ...over,
})

function renderCard(over: Partial<CalendarEvent> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <BookingQuickView event={event(over)} locale="en" />
    </IntlProvider>,
  )
}

describe('BookingQuickView', () => {
  it('shows status label, code, renter, vehicle, total, and the view-details affordance', () => {
    renderCard()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('ABCD2345')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    // Assert against the real formatter, not a hardcoded glyph — Node's full-ICU
    // renders JPY with the fullwidth yen (U+FFE5), the browser likewise.
    expect(screen.getByText(formatJpy(24000))).toBeInTheDocument()
    expect(screen.getByText(/View full details/)).toBeInTheDocument()
  })

  it('formats the time range in JST regardless of the host timezone', () => {
    renderCard()
    // 01:00Z..02:00Z render as 10:00..11:00 Asia/Tokyo (machine-independent).
    expect(screen.getByText(/10:00/)).toBeInTheDocument()
    expect(screen.getByText(/11:00/)).toBeInTheDocument()
  })

  it('falls back to renterEmail then "—" for the renter line', () => {
    renderCard({ renterName: null })
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
  })

  it('shows "—" for an unassigned vehicle and omits the total when null', () => {
    renderCard({ vehicleName: null, totalPrice: null })
    expect(screen.getByText('—')).toBeInTheDocument()
    // No currency glyph at all when the total is null (match either yen codepoint).
    expect(screen.queryByText(/[¥￥]/)).toBeNull()
  })
})
