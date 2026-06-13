import { BookingActionsPanel } from '@/vite/operator-bookings/BookingActionsPanel'
import type { OperatorBookingStatus } from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const invalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))
vi.mock('@/vite/session', () => ({ useSession: () => ({ data: { csrfToken: 'csrf-1' } }) }))

const en = enMessages.bookings.operator.detail.actions

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderPanel(status: OperatorBookingStatus) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <BookingActionsPanel bookingId="bk-1" status={status} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

const button = (name: string) => screen.queryByRole('button', { name })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BookingActionsPanel', () => {
  it('CONFIRMED → mark-active + substitute + cancel, but never mark-completed', () => {
    renderPanel('CONFIRMED')
    expect(button(en.markActive)).toBeInTheDocument()
    expect(button(en.substitute)).toBeInTheDocument()
    expect(button(en.cancel)).toBeInTheDocument()
    expect(button(en.markCompleted)).toBeNull()
  })

  it('ACTIVE → mark-completed + substitute, but NOT cancel (the fee endpoint is CONFIRMED-only)', () => {
    renderPanel('ACTIVE')
    expect(button(en.markCompleted)).toBeInTheDocument()
    expect(button(en.substitute)).toBeInTheDocument()
    expect(button(en.cancel)).toBeNull()
    expect(button(en.markActive)).toBeNull()
  })

  it.each(['COMPLETED', 'CANCELLED'] as const)('%s → no action buttons (terminal)', (status) => {
    renderPanel(status)
    for (const name of [en.markActive, en.markCompleted, en.substitute, en.cancel]) {
      expect(button(name)).toBeNull()
    }
    expect(screen.getByText(en.terminal)).toBeInTheDocument()
  })

  it('cancelling a CONFIRMED booking confirms, then surfaces the returned fee tier', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { id: 'bk-1', status: 'CANCELLED' },
        cancellation: { tier: 'TIER_30', feePercentage: 30, feeAmount: 7200, refundAmount: 16800 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel('CONFIRMED')

    await user.click(screen.getByRole('button', { name: en.cancel }))
    await user.click(screen.getByRole('button', { name: en.confirm }))

    expect(await screen.findByText(en.cancelled)).toBeInTheDocument()
    expect(screen.getByText(/TIER_30/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/cancel'))).toBe(true)
  })

  it('marking active PATCHes the status to ACTIVE after the confirm step', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: 'bk-1', status: 'ACTIVE' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel('CONFIRMED')

    await user.click(screen.getByRole('button', { name: en.markActive }))
    await user.click(screen.getByRole('button', { name: en.confirm }))

    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/status'))
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ status: 'ACTIVE' })
    })
  })
})
