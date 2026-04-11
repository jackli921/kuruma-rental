// Issue #65: inline rental-rules validation on the booking form. The form
// calls the same @kuruma/shared helper as the API, so a violation should
// disable the submit button and show the matching translated hint *before*
// the renter ever hits the server.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
      const count = Number(values?.count ?? 0)
      const duration = String(values?.duration ?? '')
      if (namespace === 'bookings.new') {
        const messages: Record<string, string> = {
          vehicleInfo: 'Vehicle details',
          pickupDate: 'Pickup date and time',
          returnDate: 'Return date and time',
          selectDates: 'Select dates to check availability',
          confirmBooking: 'Confirm booking',
          submitting: 'Booking...',
          auto: 'Auto',
          manual: 'Manual',
          'rentalRuleViolation.advance': `This car must be booked at least ${duration} in advance.`,
          'rentalRuleViolation.min': `This car requires a minimum rental of ${duration}.`,
          'rentalRuleViolation.max': `This car allows a maximum rental of ${duration}.`,
        }
        if (key === 'seats') return `${count} seats`
        return messages[key] ?? key
      }
      if (namespace === 'vehicles.detail.rentalRules') {
        if (key === 'hours') return count === 1 ? `${count} hour` : `${count} hours`
        if (key === 'days') return count === 1 ? `${count} day` : `${count} days`
      }
      return key
    },
}))

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/bookings', () => ({
  createBooking: vi.fn().mockResolvedValue({ success: true, bookingId: 'b1' }),
}))

import { BookingForm } from '@/app/[locale]/bookings/new/BookingForm'

// Future-dated ISO strings with second precision, formatted for
// <input type="datetime-local"> (no Z, no milliseconds).
function datetimeLocal(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function makeVehicle(
  rules: {
    minRentalHours?: number | null
    maxRentalHours?: number | null
    advanceBookingHours?: number | null
  } = {},
) {
  return {
    id: 'v1',
    name: 'Toyota Alphard',
    photos: [],
    seats: 7,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    minRentalHours: rules.minRentalHours ?? null,
    maxRentalHours: rules.maxRentalHours ?? null,
    advanceBookingHours: rules.advanceBookingHours ?? null,
  }
}

describe('BookingForm rental-rules validation', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows no rental-rule message when no rules are set', async () => {
    const user = userEvent.setup()
    render(<BookingForm vehicle={makeVehicle()} isAuthenticated={true} />)

    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(50))

    expect(screen.queryByText(/This car/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled()
  })

  it('disables submit and shows min-duration message when duration is below minimum', async () => {
    const user = userEvent.setup()
    render(<BookingForm vehicle={makeVehicle({ minRentalHours: 6 })} isAuthenticated={true} />)

    // 2h duration on a vehicle that requires min 6h.
    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(50))

    expect(screen.getByText('This car requires a minimum rental of 6 hours.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
  })

  it('disables submit and shows max-duration message when duration is above maximum', async () => {
    const user = userEvent.setup()
    render(<BookingForm vehicle={makeVehicle({ maxRentalHours: 72 })} isAuthenticated={true} />)

    // 100h duration on a vehicle that allows max 72h (3 days).
    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(148))

    expect(screen.getByText('This car allows a maximum rental of 3 days.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
  })

  it('disables submit and shows advance-booking message when start is too soon', async () => {
    const user = userEvent.setup()
    render(
      <BookingForm vehicle={makeVehicle({ advanceBookingHours: 24 })} isAuthenticated={true} />,
    )

    // Start in 2h on a vehicle requiring 24h advance.
    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(2))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(10))

    expect(
      screen.getByText('This car must be booked at least 1 day in advance.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
  })

  it('enables submit when dates satisfy all rules', async () => {
    const user = userEvent.setup()
    render(
      <BookingForm
        vehicle={makeVehicle({ minRentalHours: 6, maxRentalHours: 240, advanceBookingHours: 24 })}
        isAuthenticated={true}
      />,
    )

    // Start in 48h, 48h duration — satisfies all three rules.
    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(48))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(96))

    expect(screen.queryByText(/This car/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeEnabled()
  })

  it('flips to advance-booking message when only that rule fails among several', async () => {
    // Min=4 OK (duration 8h), max=72 OK, advance=24 violated (start in 2h).
    // The precedence test from the shared lib is already covered; here we
    // just confirm the form surfaces the right message for this combo.
    const user = userEvent.setup()
    render(
      <BookingForm
        vehicle={makeVehicle({ minRentalHours: 4, maxRentalHours: 72, advanceBookingHours: 24 })}
        isAuthenticated={true}
      />,
    )

    await user.type(screen.getByLabelText('Pickup date and time'), datetimeLocal(2))
    await user.type(screen.getByLabelText('Return date and time'), datetimeLocal(10))

    expect(
      screen.getByText('This car must be booked at least 1 day in advance.'),
    ).toBeInTheDocument()
  })
})
