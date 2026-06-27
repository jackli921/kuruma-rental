import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { FleetTimeline, bookingIdFromTimelineItem } from './FleetTimeline'
import type { CalendarBookingRow } from './api'

const VEHICLES = [
  { id: 'v1', name: 'Corolla' },
  { id: 'v2', name: 'Hiace' },
]

function row(over: Partial<CalendarBookingRow> & { id: string }): CalendarBookingRow {
  return {
    bookingCode: `CODE-${over.id}`,
    status: 'CONFIRMED',
    startAt: '2026-07-03T09:00:00.000Z',
    endAt: '2026-07-04T09:00:00.000Z',
    effectiveEndAt: '2026-07-04T09:00:00.000Z',
    vehicleId: 'v1',
    renterName: null,
    renterEmail: null,
    totalPrice: null,
    ...over,
  }
}

function renderTimeline(rows: CalendarBookingRow[], onSelectEvent: (id: string) => void = vi.fn()) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <FleetTimeline
        rows={rows}
        vehicles={VEHICLES}
        date={new Date('2026-07-01T00:00:00.000Z')}
        locale="en"
        onViewChange={vi.fn()}
        onDateChange={vi.fn()}
        onSelectEvent={onSelectEvent}
      />
    </IntlProvider>,
  )
}

describe('bookingIdFromTimelineItem', () => {
  it('returns the id unchanged for a booked-band bar', () => {
    expect(bookingIdFromTimelineItem('booking-123')).toBe('booking-123')
  })

  it('strips the ::turnaround suffix so the tail opens the same booking', () => {
    expect(bookingIdFromTimelineItem('booking-123::turnaround')).toBe('booking-123')
  })

  it('does not strip an interior ::turnaround that is not the suffix', () => {
    expect(bookingIdFromTimelineItem('a::turnaround::b')).toBe('a::turnaround::b')
  })
})

describe('FleetTimeline', () => {
  it('renders a row per fleet vehicle', () => {
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })])
    expect(screen.getByText('Corolla')).toBeInTheDocument()
    expect(screen.getByText('Hiace')).toBeInTheDocument()
  })

  it('adds an Unassigned row only when a class-only float is present', () => {
    const { rerender } = renderTimeline([row({ id: 'b1', vehicleId: 'v1' })])
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()

    rerender(
      <IntlProvider locale="en" messages={en}>
        <FleetTimeline
          rows={[row({ id: 'b2', vehicleId: null, renterName: 'Bob' })]}
          vehicles={VEHICLES}
          date={new Date('2026-07-01T00:00:00.000Z')}
          locale="en"
          onViewChange={vi.fn()}
          onDateChange={vi.fn()}
          onSelectEvent={vi.fn()}
        />
      </IntlProvider>,
    )
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('opens the clicked booking, stripping the turnaround tail', () => {
    const onSelectEvent = vi.fn()
    // A booking whose effective end runs past its booked end → a booked bar plus a
    // turnaround tail bar, both titled "Alice". Clicking either must open b1.
    renderTimeline(
      [
        row({
          id: 'b1',
          renterName: 'Alice',
          endAt: '2026-07-04T09:00:00.000Z',
          effectiveEndAt: '2026-07-04T15:00:00.000Z',
        }),
      ],
      onSelectEvent,
    )
    const bars = screen.getAllByText('Alice')
    expect(bars.length).toBeGreaterThan(0)
    const bar = bars[0]?.closest('.rct-item')
    expect(bar).not.toBeNull()
    fireEvent.mouseDown(bar as Element)
    fireEvent.mouseUp(bar as Element)
    expect(onSelectEvent).toHaveBeenCalledWith('b1')
  })
})
