import { SubstituteVehicleDialog } from '@/vite/operator-bookings/SubstituteVehicleDialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The dialog reads the session CSRF token and re-runs the route loader on a
// successful swap; stub both so the test exercises the data flow, not the shell.
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

function renderDialog() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <SubstituteVehicleDialog bookingId="bk-1" open onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SubstituteVehicleDialog', () => {
  it('lists the eligible candidates and submits the chosen vehicle id with the CSRF token', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('substitution-candidates')) {
        return jsonResponse({
          success: true,
          data: [
            { id: 'veh-2', name: 'Toyota Aqua' },
            { id: 'veh-3', name: 'Nissan Note' },
          ],
        })
      }
      return jsonResponse({ success: true, data: { id: 'bk-1', status: 'CONFIRMED' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    // Options render only once the candidates query resolves.
    await screen.findByRole('option', { name: 'Nissan Note' })
    await user.selectOptions(screen.getByLabelText(en.substituteVehicleLabel), 'veh-3')
    await user.click(screen.getByRole('button', { name: en.substituteSubmit }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/substitute'))).toBe(true),
    )
    const subCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/substitute'))!
    const init = subCall[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ newVehicleId: 'veh-3' })
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows an empty state and disables submit when no eligible vehicle is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [] })),
    )
    renderDialog()

    expect(await screen.findByText(en.substituteEmpty)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.substituteSubmit })).toBeDisabled()
  })
})
