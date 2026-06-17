import { CustomerPicker } from '@/vite/operator-bookings/CustomerPicker'
import type { CustomerSearchResult } from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The picker drives the REAL customerSearchQueryOptions + searchCustomers stack;
// only the network is faked (stubbing the export bypasses the intra-module call),
// so these tests exercise the genuine 2-char enabled gate, URL and unwrap.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const c = enMessages.bookings.operator.newBooking
const tanaka: CustomerSearchResult = {
  id: 'r-9',
  name: 'Tanaka Hiro',
  email: 'tanaka@example.com',
  phone: '+81-90-1234-5678',
}

function renderPicker(props: Record<string, unknown> = {}) {
  const onSelect = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <CustomerPicker selected={null} onSelect={onSelect} debounceMs={0} {...props} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onSelect }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomerPicker', () => {
  it('shows the min-length hint and does not search below 2 characters', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ delay: null })
    renderPicker()

    expect(screen.getByText(c.customerSearchHint)).toBeInTheDocument()
    await user.type(screen.getByLabelText(c.customerSearchLabel), 't')
    // a single char never reaches the 2-char enabled gate -> no request fires
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches the typed query (>=2 chars) and lists the matching customers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [tanaka] }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ delay: null })
    renderPicker()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')

    expect(await screen.findByText('Tanaka Hiro')).toBeInTheDocument()
    expect(screen.getByText('tanaka@example.com · +81-90-1234-5678')).toBeInTheDocument()
    const url = new URL(fetchMock.mock.calls.at(-1)![0] as string, 'http://x')
    expect(url.pathname).toBe('/api/customers/search')
    expect(url.searchParams.get('q')).toBe('tan')
  })

  it('calls onSelect with the chosen customer when a result is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [tanaka] })),
    )
    const user = userEvent.setup({ delay: null })
    const { onSelect } = renderPicker()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')
    await user.click(await screen.findByText('Tanaka Hiro'))

    expect(onSelect).toHaveBeenCalledWith(tanaka)
  })

  it('shows the empty message when the search returns no matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [] })),
    )
    const user = userEvent.setup({ delay: null })
    renderPicker()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'zzz')

    expect(await screen.findByText(c.customerSearchEmpty)).toBeInTheDocument()
  })

  it('shows the error message when the search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'boom' }, 500)),
    )
    const user = userEvent.setup({ delay: null })
    renderPicker()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')

    expect(await screen.findByText(c.customerSearchError)).toBeInTheDocument()
  })

  it('renders the selected customer with a Change button that clears the selection', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSelect } = renderPicker({ selected: tanaka })

    expect(screen.getByText(c.customerSelectedLabel)).toBeInTheDocument()
    expect(screen.getByText('Tanaka Hiro')).toBeInTheDocument()
    // the search input is hidden while a customer is attached
    expect(screen.queryByLabelText(c.customerSearchLabel)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: c.customerChange }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('falls back to a placeholder name and still shows the contact line when name is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [{ id: 'r-1', name: null, email: null, phone: '+81-1' }],
        }),
      ),
    )
    const user = userEvent.setup({ delay: null })
    renderPicker()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'abc')

    expect(await screen.findByText(c.customerUnnamed)).toBeInTheDocument()
    expect(screen.getByText('+81-1')).toBeInTheDocument()
  })
})
