import type { SubstitutionVehicle } from '@/lib/substitution'
import { SubstituteVehicleAction } from '@/vite/operator-bookings/SubstituteVehicleAction'
import type { OperatorBookingDetailDto } from '@/vite/operator-bookings/api'
import { substituteBooking } from '@/vite/operator-bookings/api'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
} from '@/vite/operator-bookings/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-bookings/api', async (orig) => {
  const actual = await orig<typeof import('@/vite/operator-bookings/api')>()
  return { ...actual, substituteBooking: vi.fn() }
})
const substituteBookingMock = vi.mocked(substituteBooking)

const sub = enMessages.bookings.operator.substitute

function candidateVehicle(over: Partial<SubstitutionVehicle> = {}): SubstitutionVehicle {
  return {
    id: 'veh-2',
    classId: 'c1',
    pickupLocationId: 'l1',
    name: 'Honda Fit',
    licensePlate: 'OSAKA 5678',
    status: 'AVAILABLE',
    ...over,
  }
}

function bookingDetail(over: Partial<OperatorBookingDetailDto> = {}): OperatorBookingDetailDto {
  return {
    id: 'bk-1',
    bookingCode: 'ABCD2345',
    renterId: 'r-1',
    classId: 'c1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'l1',
    dropoffLocationId: 'l1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T02:00:00.000Z',
    status: 'CONFIRMED',
    source: 'WEB',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 24000,
    notes: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 'csrf-token',
}
const bypassSession: Session = { user: { id: 'u', role: 'PLATFORM_ADMIN' }, csrfToken: 't' }

function renderAction(
  session: Session | null,
  booking: OperatorBookingDetailDto,
  vehicles: SubstitutionVehicle[],
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <SubstituteVehicleAction booking={booking} vehicles={vehicles} session={session} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('SubstituteVehicleAction', () => {
  beforeEach(() => {
    substituteBookingMock.mockReset()
    substituteBookingMock.mockResolvedValue(bookingDetail({ assignedVehicleId: 'veh-2' }))
  })

  it('shows the Substitute action for a tenant-scoped operator on a confirmed booking', () => {
    renderAction(operatorSession, bookingDetail(), [candidateVehicle()])
    expect(screen.getByRole('button', { name: sub.action })).toBeInTheDocument()
  })

  it('hides the action and shows a read-only note for a bypass role with no operatorId', () => {
    renderAction(bypassSession, bookingDetail(), [candidateVehicle()])
    expect(screen.queryByRole('button', { name: sub.action })).not.toBeInTheDocument()
    expect(screen.getByText(sub.readOnly)).toBeInTheDocument()
  })

  it('hides the action and explains it is unavailable for a completed booking', () => {
    renderAction(operatorSession, bookingDetail({ status: 'COMPLETED' }), [candidateVehicle()])
    expect(screen.queryByRole('button', { name: sub.action })).not.toBeInTheDocument()
    expect(screen.getByText(sub.unavailable)).toBeInTheDocument()
  })

  it('lists only same-class, same-location, available cars (excluding the current one)', async () => {
    const user = userEvent.setup()
    renderAction(operatorSession, bookingDetail(), [
      candidateVehicle({ id: 'veh-1', name: 'Current Car' }), // assigned -> excluded
      candidateVehicle({ id: 'veh-2', name: 'Honda Fit' }), // match
      candidateVehicle({ id: 'veh-3', name: 'Big Van', classId: 'c2' }), // wrong class
      candidateVehicle({ id: 'veh-4', name: 'Broken Car', status: 'MAINTENANCE' }), // unavailable
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))

    expect(screen.getByRole('radio', { name: /Honda Fit/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Current Car/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Big Van/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Broken Car/ })).not.toBeInTheDocument()
  })

  it('substitutes the picked car, sending its id + reason + the session CSRF token', async () => {
    const user = userEvent.setup()
    renderAction(operatorSession, bookingDetail(), [
      candidateVehicle({ id: 'veh-2', name: 'Honda Fit' }),
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.click(screen.getByRole('radio', { name: /Honda Fit/ }))
    await user.type(screen.getByLabelText(sub.reasonLabel), 'mechanical fault')
    await user.click(screen.getByRole('button', { name: sub.submit }))

    await waitFor(() =>
      expect(substituteBookingMock).toHaveBeenCalledWith(
        'bk-1',
        'veh-2',
        'mechanical fault',
        'csrf-token',
      ),
    )
  })

  it('shows the empty-candidate state and disables submit when no replacement exists', async () => {
    const user = userEvent.setup()
    renderAction(operatorSession, bookingDetail(), [
      candidateVehicle({ id: 'veh-1', name: 'Current Car' }),
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))

    expect(screen.getByText(sub.noCandidates)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sub.submit })).toBeDisabled()
  })

  it('surfaces an error when the substitution fails (e.g. the car was just booked)', async () => {
    const user = userEvent.setup()
    substituteBookingMock.mockRejectedValue(new Error('Vehicle is no longer available'))
    renderAction(operatorSession, bookingDetail(), [
      candidateVehicle({ id: 'veh-2', name: 'Honda Fit' }),
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.click(screen.getByRole('radio', { name: /Honda Fit/ }))
    await user.click(screen.getByRole('button', { name: sub.submit }))

    expect(await screen.findByText(sub.error)).toBeInTheDocument()
  })

  it('invalidates the booking detail and events queries on success', async () => {
    const user = userEvent.setup()
    const queryClient = renderAction(operatorSession, bookingDetail(), [
      candidateVehicle({ id: 'veh-2', name: 'Honda Fit' }),
    ])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.click(screen.getByRole('radio', { name: /Honda Fit/ }))
    await user.click(screen.getByRole('button', { name: sub.submit }))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operatorBookingDetailQueryOptions('bk-1').queryKey,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: bookingEventsQueryOptions('bk-1').queryKey,
      })
    })
  })
})
