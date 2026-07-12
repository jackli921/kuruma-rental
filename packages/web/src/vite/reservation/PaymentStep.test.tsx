import { ApiError } from '@/lib/api-error'
import type { CreateBookingDraft } from '@/vite/bookings/api'
import { FeatureFlagsProvider } from '@/vite/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// createBooking is the money write — spy on it instead of the network so the
// tests assert the exact pinned payload the renter's agreement produces.
const createBookingSpy = vi.fn()
vi.mock('@/vite/bookings/api', () => ({
  createBooking: (...args: unknown[]) => createBookingSpy(...args),
}))

const navigateSpy = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf' } }),
}))

import { PaymentStep } from './PaymentStep'

const terms = {
  version: 'v3',
  locale: 'en',
  title: 'Osaka Cars Rental Terms',
  body: 'No smoking. Return with a full tank.',
  acceptanceLabel: 'I agree to these terms',
  contentHash: 'hash-v3',
}

const draft = {
  fulfillmentMode: 'SPECIFIC',
  requestedVehicleId: 'v1',
  pickupLocationId: 'loc1',
  dropoffLocationId: 'loc1',
  startAt: '2026-08-01T01:00:00.000Z',
  endAt: '2026-08-03T01:00:00.000Z',
  insuranceOptionId: null,
  addOnIds: [],
  idempotencyKey: 'idem-1',
} satisfies CreateBookingDraft

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: terms }),
  } as Response)
})
afterEach(() => {
  createBookingSpy.mockReset()
  navigateSpy.mockReset()
  fetchMock.mockReset()
})

// `cachedTerms` seeds the published-terms query so `terms` is available on first
// render without an async wait; `null` simulates an operator with no terms.
function renderPayment(opts: { flag: boolean; cachedTerms?: typeof terms | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], { OPERATOR_TERMS: opts.flag })
  if (opts.cachedTerms !== undefined) {
    client.setQueryData(['operator-terms', 'published', 'op1', 'en'], opts.cachedTerms)
  }
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <PaymentStep locale="en" operatorId="op1" bookingInput={draft} onBack={() => {}} />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

function acceptDisclaimer(): void {
  fireEvent.click(screen.getByRole('checkbox'))
}
function clickReserve(): void {
  fireEvent.click(screen.getByRole('button', { name: en.reservation.payment.submit }))
}

describe('PaymentStep operator-terms gate (#877 Slice B)', () => {
  it('opens the terms modal on Reserve instead of submitting when terms are published', async () => {
    renderPayment({ flag: true, cachedTerms: terms })
    acceptDisclaimer()
    clickReserve()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(terms.title)
    expect(dialog).toHaveTextContent(terms.body)
    expect(createBookingSpy).not.toHaveBeenCalled()
  })

  it('submits with the pinned version + locale after the renter agrees', async () => {
    createBookingSpy.mockResolvedValue({ id: 'b1' })
    renderPayment({ flag: true, cachedTerms: terms })
    acceptDisclaimer()
    clickReserve()
    fireEvent.click(await screen.findByRole('button', { name: /agree/i }))

    await waitFor(() => expect(createBookingSpy).toHaveBeenCalledTimes(1))
    expect(createBookingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disclaimerAccepted: true,
        operatorRentalTermsAccepted: true,
        operatorRentalTermsAcceptedVersion: 'v3',
        locale: 'en',
      }),
      'csrf',
    )
  })

  it('re-presents the modal and warns on a 422 OPERATOR_TERMS_CHANGED', async () => {
    createBookingSpy.mockRejectedValue(new ApiError('changed', 422, 'OPERATOR_TERMS_CHANGED'))
    renderPayment({ flag: true, cachedTerms: terms })
    acceptDisclaimer()
    clickReserve()
    fireEvent.click(await screen.findByRole('button', { name: /agree/i }))

    await waitFor(() => expect(createBookingSpy).toHaveBeenCalled())
    expect(await screen.findByText(en.reservation.payment.termsChanged)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('submits directly (no modal, no pin fields) when the operator has no published terms', async () => {
    createBookingSpy.mockResolvedValue({ id: 'b1' })
    renderPayment({ flag: true, cachedTerms: null })
    acceptDisclaimer()
    clickReserve()

    await waitFor(() => expect(createBookingSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    const payload = createBookingSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('operatorRentalTermsAccepted')
  })

  it('submits directly when the OPERATOR_TERMS flag is off, even if terms are cached (dark)', async () => {
    createBookingSpy.mockResolvedValue({ id: 'b1' })
    renderPayment({ flag: false, cachedTerms: terms })
    acceptDisclaimer()
    clickReserve()

    await waitFor(() => expect(createBookingSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    const payload = createBookingSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('operatorRentalTermsAccepted')
  })
})
