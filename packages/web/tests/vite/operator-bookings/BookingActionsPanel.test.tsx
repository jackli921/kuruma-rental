import type { BookingDto } from '@/vite/bookings/api'
import { BookingActionsPanel } from '@/vite/operator-bookings/BookingActionsPanel'
import type { OperatorBookingDetailDto } from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const sub = enMessages.bookings.operator.detail.substitute

function detail(over: Partial<BookingDto> = {}): OperatorBookingDetailDto {
  return {
    id: 'bk-1',
    bookingCode: 'H7K2M9PQ',
    renterId: 'r-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T01:00:00.000Z',
    status: 'CONFIRMED',
    source: 'DIRECT',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 18000,
    notes: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...over,
  }
}

function fleetVehicle(over: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: 'veh-2',
    operatorId: 'op-1',
    classId: 'cls-1',
    pickupLocationId: 'loc-1',
    name: 'Honda Fit',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 9999',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 7000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...over,
  }
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

const bypassSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

function renderPanel(
  session: Session | null,
  bookingDetail: OperatorBookingDetailDto,
  fleet: OperatorFleetVehicle[] = [fleetVehicle({ id: 'veh-1' }), fleetVehicle()],
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={enMessages}>
        <BookingActionsPanel detail={bookingDetail} session={session} fleet={fleet} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('BookingActionsPanel substitution gating (#610)', () => {
  it('offers the Substitute action to a tenant-scoped operator on a live booking', () => {
    renderPanel(operatorSession, detail({ status: 'CONFIRMED' }))
    expect(screen.getByRole('button', { name: sub.action })).toBeInTheDocument()
  })

  it('renders nothing for a bypass role with no operatorId (read-only oversight)', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <BookingActionsPanel
            detail={detail({ status: 'CONFIRMED' })}
            session={bypassSession}
            fleet={[fleetVehicle()]}
          />
        </IntlProvider>
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables substitution on a terminal booking, explaining why instead of the action', () => {
    renderPanel(operatorSession, detail({ status: 'COMPLETED' }))
    expect(screen.queryByRole('button', { name: sub.action })).not.toBeInTheDocument()
    expect(screen.getByText(sub.unavailable)).toBeInTheDocument()
  })

  it('only surfaces same-class, same-location, AVAILABLE candidates (never the assigned car)', async () => {
    const user = userEvent.setup()
    renderPanel(operatorSession, detail({ status: 'CONFIRMED' }), [
      fleetVehicle({ id: 'veh-1', name: 'Assigned Car' }), // the current car — excluded
      fleetVehicle({ id: 'ok', name: 'Same Class Same Loc' }), // valid
      fleetVehicle({ id: 'other-class', name: 'Other Class', classId: 'cls-2' }), // wrong class
      fleetVehicle({ id: 'other-loc', name: 'Other Loc', pickupLocationId: 'loc-9' }), // wrong loc
      fleetVehicle({ id: 'maint', name: 'In Maintenance', status: 'MAINTENANCE' }), // not available
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))

    expect(screen.getByRole('option', { name: /Same Class Same Loc/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Assigned Car/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Other Class/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Other Loc/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /In Maintenance/ })).not.toBeInTheDocument()
  })
})
