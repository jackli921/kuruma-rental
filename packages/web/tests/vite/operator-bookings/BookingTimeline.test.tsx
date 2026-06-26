import { BookingTimeline } from '@/vite/operator-bookings/BookingTimeline'
import type { BookingEventDto } from '@/vite/operator-bookings/api'
import { render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function event(
  over: Partial<BookingEventDto> & Pick<BookingEventDto, 'type' | 'payload'>,
): BookingEventDto {
  return {
    id: 'evt',
    actorId: null,
    createdAt: '2026-07-01T01:00:00.000Z',
    ...over,
    // #716: payload.type mirrors the authoritative event type, exactly as the API's
    // toBookingEvent backfills it for legacy rows — so a fixture sets only `type`.
    payload: { ...over.payload, type: over.type } as BookingEventDto['payload'],
  }
}

function renderTimeline(events: BookingEventDto[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <BookingTimeline events={events} locale="en" />
    </IntlProvider>,
  )
}

const created = event({
  id: 'e0',
  type: 'BOOKING_CREATED',
  payload: {
    requestedVehicleId: 'v-1',
    assignedVehicleId: 'v-1',
    classId: 'c-1',
    fulfillmentMode: 'SPECIFIC',
    startAt: '2026-07-01T01:00:00Z',
    endAt: '2026-07-03T01:00:00Z',
    totalPrice: 18000,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
  },
  createdAt: '2026-07-01T01:00:00.000Z',
})

describe('BookingTimeline', () => {
  it('renders the empty state when there are no events', () => {
    renderTimeline([])
    expect(screen.getByText('No events yet')).toBeInTheDocument()
  })

  it('labels a BOOKING_CREATED event', () => {
    renderTimeline([created])
    expect(screen.getByText('Booking created')).toBeInTheDocument()
  })

  it('labels a STATUS_CHANGED event with localized from/to statuses', () => {
    renderTimeline([
      event({ id: 'e1', type: 'STATUS_CHANGED', payload: { from: 'CONFIRMED', to: 'ACTIVE' } }),
    ])
    expect(screen.getByText('Status changed from Confirmed to Active')).toBeInTheDocument()
  })

  it('labels a VEHICLE_SUBSTITUTED event and shows the reason', () => {
    renderTimeline([
      event({
        id: 'e2',
        type: 'VEHICLE_SUBSTITUTED',
        payload: { fromVehicleId: 'v-1', toVehicleId: 'v-2', reason: 'Flat tyre' },
      }),
    ])
    expect(screen.getByText('Vehicle substituted')).toBeInTheDocument()
    expect(screen.getByText('Reason: Flat tyre')).toBeInTheDocument()
  })

  it('labels a BOOKING_CANCELLED event and shows the cancellation fee', () => {
    renderTimeline([
      event({
        id: 'e3',
        type: 'BOOKING_CANCELLED',
        payload: { cancellationFee: 5000, cancelledAt: '2026-07-02T01:00:00Z' },
      }),
    ])
    expect(screen.getByText('Booking cancelled')).toBeInTheDocument()
    expect(screen.getByText('Cancellation fee ￥5,000')).toBeInTheDocument()
  })

  it('renders events oldest-to-newest in document order', () => {
    renderTimeline([
      created,
      event({ id: 'e1', type: 'STATUS_CHANGED', payload: { from: 'CONFIRMED', to: 'ACTIVE' } }),
      event({ id: 'e2', type: 'STATUS_CHANGED', payload: { from: 'ACTIVE', to: 'COMPLETED' } }),
    ])
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]!).getByText('Booking created')).toBeInTheDocument()
    expect(
      within(items[1]!).getByText('Status changed from Confirmed to Active'),
    ).toBeInTheDocument()
    expect(
      within(items[2]!).getByText('Status changed from Active to Completed'),
    ).toBeInTheDocument()
  })

  it('shows each event timestamp in JST', () => {
    renderTimeline([created])
    // 2026-07-01T01:00:00Z -> Asia/Tokyo Jul 1, 2026 10:00
    expect(screen.getByText(/Jul 1, 2026/)).toBeInTheDocument()
  })

  it('labels a VEHICLE_ASSIGNED first-assign event (null → car)', () => {
    renderTimeline([
      event({
        id: 'e4',
        type: 'VEHICLE_ASSIGNED',
        payload: {
          type: 'VEHICLE_ASSIGNED',
          fromVehicleId: null,
          toVehicleId: 'v-1',
          reason: null,
        },
      }),
    ])
    expect(screen.getByText(en.bookings.operator.timeline.vehicleAssigned)).toBeInTheDocument()
  })

  it('labels a VEHICLE_ASSIGNED swap event (car → car)', () => {
    renderTimeline([
      event({
        id: 'e5',
        type: 'VEHICLE_ASSIGNED',
        payload: {
          type: 'VEHICLE_ASSIGNED',
          fromVehicleId: 'v-old',
          toVehicleId: 'v-new',
          reason: null,
        },
      }),
    ])
    expect(
      screen.getByText(en.bookings.operator.timeline.vehicleAssignedSwapped),
    ).toBeInTheDocument()
  })

  it('swap label differs from first-assign label', () => {
    expect(en.bookings.operator.timeline.vehicleAssignedSwapped).not.toBe(
      en.bookings.operator.timeline.vehicleAssigned,
    )
  })

  it('shows a reason line for VEHICLE_ASSIGNED when reason is non-null', () => {
    const reason = 'Customer requested a larger car'
    renderTimeline([
      event({
        id: 'e6',
        type: 'VEHICLE_ASSIGNED',
        payload: { type: 'VEHICLE_ASSIGNED', fromVehicleId: null, toVehicleId: 'v-1', reason },
      }),
    ])
    expect(screen.getByText(`Reason: ${reason}`)).toBeInTheDocument()
  })

  it('does not render a reason line for VEHICLE_ASSIGNED when reason is null', () => {
    renderTimeline([
      event({
        id: 'e7',
        type: 'VEHICLE_ASSIGNED',
        payload: {
          type: 'VEHICLE_ASSIGNED',
          fromVehicleId: null,
          toVehicleId: 'v-1',
          reason: null,
        },
      }),
    ])
    expect(screen.queryByText(/Reason:/)).toBeNull()
  })
})
