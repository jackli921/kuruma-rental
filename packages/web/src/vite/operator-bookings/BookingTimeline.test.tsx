import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { BookingTimeline } from './BookingTimeline'
import type { BookingEventDto } from './api'

function makeEvent(
  over: Partial<BookingEventDto> & Pick<BookingEventDto, 'type' | 'payload'>,
): BookingEventDto {
  return {
    id: 'evt-1',
    actorId: null,
    createdAt: '2026-06-25T10:00:00.000Z',
    ...over,
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

describe('BookingTimeline — VEHICLE_ASSIGNED', () => {
  it('renders the first-assign label when fromVehicleId is null', () => {
    renderTimeline([
      makeEvent({
        type: 'VEHICLE_ASSIGNED',
        payload: {
          type: 'VEHICLE_ASSIGNED',
          fromVehicleId: null,
          toVehicleId: 'v-1',
          reason: null,
        },
      }),
    ])
    expect(screen.getByText(en.bookings.operator.timeline.vehicleAssigned)).toBeTruthy()
  })

  it('renders a distinct swap label when fromVehicleId is non-null', () => {
    renderTimeline([
      makeEvent({
        type: 'VEHICLE_ASSIGNED',
        payload: {
          type: 'VEHICLE_ASSIGNED',
          fromVehicleId: 'v-old',
          toVehicleId: 'v-new',
          reason: null,
        },
      }),
    ])
    expect(screen.getByText(en.bookings.operator.timeline.vehicleAssignedSwapped)).toBeTruthy()
  })

  it('swap label differs from first-assign label', () => {
    expect(en.bookings.operator.timeline.vehicleAssignedSwapped).not.toBe(
      en.bookings.operator.timeline.vehicleAssigned,
    )
  })

  it('renders the reason detail line when reason is non-null', () => {
    const reason = 'Customer requested a larger car'
    renderTimeline([
      makeEvent({
        type: 'VEHICLE_ASSIGNED',
        payload: { type: 'VEHICLE_ASSIGNED', fromVehicleId: null, toVehicleId: 'v-1', reason },
      }),
    ])
    expect(screen.getByText(`Reason: ${reason}`)).toBeTruthy()
  })

  it('does not render a reason line when reason is null', () => {
    renderTimeline([
      makeEvent({
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
