// Issue #311: renter-facing class booking form. Tests cover the four
// behaviours called out in the issue brief:
//
// 1. valid dates trigger an availability lookup
// 2. "no cars available" disables the Confirm button
// 3. Confirm submits classId (no vehicleId), startAt, endAt
// 4. no date selection keeps Confirm disabled and the prompt visible

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchAvailability = vi.fn()
const mockCreate = vi.fn()
const mockPush = vi.fn()

vi.mock('@/modules/classes', () => ({
  fetchClassAvailability: (...args: unknown[]) => mockFetchAvailability(...args),
}))

vi.mock('@/lib/bookings', () => ({
  createClassBooking: (...args: unknown[]) => mockCreate(...args),
}))

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      pickupDate: 'Pickup date and time',
      returnDate: 'Return date and time',
      selectDates: 'Select dates to check availability',
      checkingAvailability: 'Checking availability...',
      available: 'Available',
      notAvailable: 'No cars available for these dates.',
      confirmBooking: 'Confirm booking',
      submitting: 'Booking...',
      availableCount: `${values?.count ?? 0} of ${values?.total ?? 0} cars available`,
    }
    return messages[key] ?? key
  },
}))

import { ClassBookingForm } from '@/app/[locale]/bookings/new/ClassBookingForm'

function datetimeLocal(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const VEHICLE_CLASS = {
  id: 'class-001',
  slug: 'alphard',
  name: 'Toyota Alphard',
}

describe('ClassBookingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps submit disabled and shows the prompt before dates are picked', () => {
    render(<ClassBookingForm vehicleClass={VEHICLE_CLASS} />)

    expect(screen.getByText('Select dates to check availability')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
    expect(mockFetchAvailability).not.toHaveBeenCalled()
  })

  it('fetches availability when both dates are valid and enables submit when cars are free', async () => {
    mockFetchAvailability.mockResolvedValue({ totalCars: 3, availableCars: 2 })

    const user = userEvent.setup()
    render(<ClassBookingForm vehicleClass={VEHICLE_CLASS} />)

    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(72))

    await waitFor(() => {
      expect(mockFetchAvailability).toHaveBeenCalledTimes(1)
    })
    const [slug, from, to] = mockFetchAvailability.mock.calls[0] as [string, Date, Date]
    expect(slug).toBe('alphard')
    expect(from).toBeInstanceOf(Date)
    expect(to).toBeInstanceOf(Date)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled()
    })
  })

  it('disables Confirm when availableCars is 0 and shows the "not available" message', async () => {
    mockFetchAvailability.mockResolvedValue({ totalCars: 3, availableCars: 0 })

    const user = userEvent.setup()
    render(<ClassBookingForm vehicleClass={VEHICLE_CLASS} />)

    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(72))

    await waitFor(() => {
      expect(screen.getByText('No cars available for these dates.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
  })

  it('submits classId (no vehicleId) when Confirm is clicked', async () => {
    mockFetchAvailability.mockResolvedValue({ totalCars: 3, availableCars: 2 })
    mockCreate.mockResolvedValue({ success: true, bookingId: 'b1' })

    const user = userEvent.setup()
    render(<ClassBookingForm vehicleClass={VEHICLE_CLASS} />)

    const start = datetimeLocal(48)
    const end = datetimeLocal(72)
    await user.type(screen.getByLabelText('Pickup date and time'), start)
    await user.type(screen.getByLabelText('Return date and time'), end)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })
    const payload = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.classId).toBe('class-001')
    expect(payload).not.toHaveProperty('vehicleId')
    expect(typeof payload.startAt).toBe('string')
    expect(typeof payload.endAt).toBe('string')
  })

  it('navigates to confirmation page on successful submit', async () => {
    mockFetchAvailability.mockResolvedValue({ totalCars: 3, availableCars: 2 })
    mockCreate.mockResolvedValue({ success: true, bookingId: 'booking-xyz' })

    const user = userEvent.setup()
    render(<ClassBookingForm vehicleClass={VEHICLE_CLASS} />)

    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(72))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled(),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/bookings/confirmation?bookingId=booking-xyz')
    })
  })
})
