import { ApiError } from '@/lib/api-error'
import { PaymentStep } from '@/vite/reservation/PaymentStep'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockNavigate, mockCreateBooking } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockCreateBooking: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))
vi.mock('@/vite/bookings/api', () => ({ createBooking: mockCreateBooking }))
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'r1', role: 'RENTER' }, csrfToken: 'csrf-1' } }),
}))

const bookingInput = {
  requestedVehicleId: 'v1',
  pickupLocationId: 'loc1',
  dropoffLocationId: 'loc1',
  startAt: '2026-07-01T01:00:00.000Z',
  endAt: '2026-07-03T01:00:00.000Z',
  insuranceOptionId: 'i1' as string | null,
  addOnIds: ['a1'],
  idempotencyKey: 'idem-1',
}

function renderStep(overrides: Partial<Parameters<typeof PaymentStep>[0]> = {}) {
  const onBack = vi.fn()
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <PaymentStep locale="en" bookingInput={bookingInput} onBack={onBack} {...overrides} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onBack }
}

afterEach(() => {
  mockNavigate.mockReset()
  mockCreateBooking.mockReset()
})

describe('PaymentStep (instant-book submit, #511)', () => {
  it('creates the booking with the CSRF token then navigates to confirmation on success', async () => {
    mockCreateBooking.mockResolvedValue({ id: 'b-9', bookingCode: 'CODE9' })
    const user = userEvent.setup()
    renderStep()

    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    await waitFor(() => expect(mockCreateBooking).toHaveBeenCalledWith(bookingInput, 'csrf-1'))
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/bookings/confirmation',
      params: { locale: 'en' },
      search: { bookingId: 'b-9' },
    })
  })

  it('shows a conflict message and does NOT navigate when the vehicle was just taken (409)', async () => {
    mockCreateBooking.mockRejectedValue(new ApiError('already booked', 409))
    const user = userEvent.setup()
    renderStep()

    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    expect(
      await screen.findByText(
        'This vehicle was just booked for these dates. Please go back and choose another.',
      ),
    ).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows a generic error on a 400 domain rejection', async () => {
    mockCreateBooking.mockRejectedValue(new ApiError('Vehicle is not available', 400))
    const user = userEvent.setup()
    renderStep()

    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    expect(
      await screen.findByText("We couldn't create your booking. Please review and try again."),
    ).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('calls onBack when the back button is pressed', async () => {
    const { onBack } = renderStep()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
