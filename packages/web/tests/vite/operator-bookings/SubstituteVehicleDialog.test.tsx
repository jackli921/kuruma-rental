import { SubstituteVehicleDialog } from '@/vite/operator-bookings/SubstituteVehicleDialog'
import * as api from '@/vite/operator-bookings/api'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
} from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const sub = enMessages.bookings.operator.detail.substitute

function candidate(over: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: 'veh-2',
    operatorId: 'op-1',
    classId: 'cls-1',
    pickupLocationId: 'loc-1',
    name: 'Toyota Aqua',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 5678',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
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

function renderDialog(candidates: OperatorFleetVehicle[], queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <SubstituteVehicleDialog bookingId="bk-1" candidates={candidates} csrfToken="csrf-tok" />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SubstituteVehicleDialog', () => {
  it('lists candidate vehicles (name + plate) when the trigger is opened', async () => {
    const user = userEvent.setup()
    renderDialog([
      candidate(),
      candidate({ id: 'veh-3', name: 'Mazda 2', licensePlate: 'KYOTO 1' }),
    ])

    await user.click(screen.getByRole('button', { name: sub.action }))

    expect(screen.getByRole('option', { name: /Toyota Aqua/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Mazda 2/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /OSAKA 5678/ })).toBeInTheDocument()
  })

  it('submits the picked vehicle id + reason + csrf and invalidates the detail and events queries', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'substituteBooking').mockResolvedValue({} as never)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog([candidate(), candidate({ id: 'veh-3', name: 'Mazda 2' })], queryClient)

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.selectOptions(screen.getByRole('combobox'), 'veh-3')
    await user.type(screen.getByLabelText(sub.reasonLabel), 'engine fault')
    await user.click(screen.getByRole('button', { name: sub.submit }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('bk-1', 'veh-3', 'engine fault', 'csrf-tok'),
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: operatorBookingDetailQueryOptions('bk-1').queryKey,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: bookingEventsQueryOptions('bk-1').queryKey,
    })
    // The dialog closes on success (the picker only renders while it is open).
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('passes null reason when the field is left blank', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'substituteBooking').mockResolvedValue({} as never)
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.click(screen.getByRole('button', { name: sub.submit }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'veh-2', null, 'csrf-tok'))
  })

  it('collapses a whitespace-only reason to null', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'substituteBooking').mockResolvedValue({} as never)
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.type(screen.getByLabelText(sub.reasonLabel), '   ')
    await user.click(screen.getByRole('button', { name: sub.submit }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'veh-2', null, 'csrf-tok'))
  })

  it('shows the empty state and disables submit when there are no candidates', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'substituteBooking')
    renderDialog([])

    await user.click(screen.getByRole('button', { name: sub.action }))

    expect(screen.getByText(sub.noCandidates)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sub.submit })).toBeDisabled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('surfaces an error message when the substitution fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'substituteBooking').mockRejectedValue(new Error('409'))
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: sub.action }))
    await user.click(screen.getByRole('button', { name: sub.submit }))

    expect(await screen.findByText(sub.error)).toBeInTheDocument()
  })
})
