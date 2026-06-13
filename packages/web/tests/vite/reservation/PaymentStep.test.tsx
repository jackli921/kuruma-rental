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
  return { onBack, client }
}

afterEach(() => {
  mockNavigate.mockReset()
  mockCreateBooking.mockReset()
})

describe('PaymentStep (instant-book submit, #511)', () => {
  it('keeps Reserve now disabled until the liability disclaimer is acknowledged (#613)', async () => {
    const user = userEvent.setup()
    renderStep()

    const submit = screen.getByRole('button', { name: 'Reserve now' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeEnabled()
  })

  it('creates the booking with the CSRF token then navigates to confirmation on success', async () => {
    const booking = { id: 'b-9', bookingCode: 'CODE9' }
    mockCreateBooking.mockResolvedValue(booking)
    const user = userEvent.setup()
    const { client } = renderStep()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    // The recorded consent (#613) rides on the POST body — the server rejects a
    // RENTER booking without it (400 CONSENT_REQUIRED).
    await waitFor(() =>
      expect(mockCreateBooking).toHaveBeenCalledWith(
        { ...bookingInput, disclaimerAccepted: true },
        'csrf-1',
      ),
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/bookings/confirmation',
      params: { locale: 'en' },
      search: { bookingId: 'b-9' },
    })
    // Must NOT seed ['bookings', id] with the raw POST result: POST omits the
    // operator.preAuthHandoffUrl that only GET /bookings/:id enriches, so a seed
    // would let the confirmation loader reuse it and hide the pre-auth CTA (#511
    // review). The key stays empty so the loader fetches the enriched read model.
    expect(client.getQueryData(['bookings', 'b-9'])).toBeUndefined()
  })

  it('shows a conflict message and does NOT navigate when the vehicle was just taken (409)', async () => {
    mockCreateBooking.mockRejectedValue(new ApiError('already booked', 409))
    const user = userEvent.setup()
    renderStep()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    expect(
      await screen.findByText(
        'This vehicle was just booked for these dates. Please go back and choose another.',
      ),
    ).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('routes a 400 "no longer available" rejection to the choose-another message, not a dead-end generic', async () => {
    mockCreateBooking.mockRejectedValue(new ApiError('Vehicle is not available', 400))
    const user = userEvent.setup()
    renderStep()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    expect(
      await screen.findByText(
        'This vehicle was just booked for these dates. Please go back and choose another.',
      ),
    ).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('calls onBack when the back button is pressed', async () => {
    const { onBack } = renderStep()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
