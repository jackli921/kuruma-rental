// Slice 6 (#392): the renter booking form. The vehicle/location/dates are fixed
// from the storefront flow, so the form's only input is insurance. Tests cover:
//   1. renders the insurance dropdown (decline + options) with submit enabled
//   2. declines coverage by default -> createBooking with insuranceOptionId null
//   3. selecting an option -> createBooking with that id; dropoff = pickup
//   4. success -> navigates to the confirmation page
//   5. a failed submit surfaces the error
//   6. no options -> shows the "no insurance" notice, no dropdown

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreate = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/bookings', () => ({
  createBooking: (...args: unknown[]) => mockCreate(...args),
}))

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      insurance: 'Insurance',
      declineInsurance: 'No insurance',
      noInsurance: 'This operator offers no insurance options.',
      insuranceHint: 'Optional coverage.',
      confirmBooking: 'Confirm booking',
      submitting: 'Booking...',
      perDay: '/ day',
    }
    return messages[key] ?? key
  },
}))

import { VehicleBookingForm } from '@/app/[locale]/bookings/new/VehicleBookingForm'

const INSURANCE = [
  { id: 'ins-1', name: 'CDW', description: null, dailyPriceJpy: 1500, deductibleJpy: 50000 },
  { id: 'ins-2', name: 'Full Cover', description: null, dailyPriceJpy: 3000, deductibleJpy: null },
]

const PROPS = {
  vehicleId: 'veh-1',
  pickupLocationId: 'loc-1',
  startAtIso: '2026-05-01T09:00:00.000Z',
  endAtIso: '2026-05-03T09:00:00.000Z',
  insuranceOptions: INSURANCE,
}

describe('VehicleBookingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the insurance dropdown and an enabled submit', () => {
    render(<VehicleBookingForm {...PROPS} />)

    expect(screen.getByLabelText('Insurance')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'No insurance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled()
  })

  it('declines coverage by default and sends the slice-6 contract (dropoff = pickup)', async () => {
    mockCreate.mockResolvedValue({ success: true, bookingId: 'b1' })
    const user = userEvent.setup()
    render(<VehicleBookingForm {...PROPS} />)

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      requestedVehicleId: 'veh-1',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-1',
      insuranceOptionId: null,
      startAt: '2026-05-01T09:00:00.000Z',
      endAt: '2026-05-03T09:00:00.000Z',
    })
  })

  it('submits the selected insurance option id', async () => {
    mockCreate.mockResolvedValue({ success: true, bookingId: 'b1' })
    const user = userEvent.setup()
    render(<VehicleBookingForm {...PROPS} />)

    await user.selectOptions(screen.getByLabelText('Insurance'), 'ins-2')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ insuranceOptionId: 'ins-2' })
  })

  it('navigates to the confirmation page on success', async () => {
    mockCreate.mockResolvedValue({ success: true, bookingId: 'booking-xyz' })
    const user = userEvent.setup()
    render(<VehicleBookingForm {...PROPS} />)

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/bookings/confirmation?bookingId=booking-xyz'),
    )
  })

  it('surfaces the error when the booking fails', async () => {
    mockCreate.mockResolvedValue({ success: false, error: 'This car was just booked.' })
    const user = userEvent.setup()
    render(<VehicleBookingForm {...PROPS} />)

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This car was just booked.'),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows the no-insurance notice and no dropdown when the operator has none', () => {
    render(<VehicleBookingForm {...PROPS} insuranceOptions={[]} />)

    expect(screen.getByText('This operator offers no insurance options.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
