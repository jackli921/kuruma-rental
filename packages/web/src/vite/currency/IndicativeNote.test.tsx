import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyProvider } from './CurrencyProvider'
import { IndicativeNote } from './IndicativeNote'

const rates: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: rates }),
  })
})
afterEach(() => fetchMock.mockReset())

function renderInProvider(ui: ReactNode, locale = 'en') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale={locale} messages={{}}>
        <CurrencyProvider>{ui}</CurrencyProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('IndicativeNote', () => {
  it('shows the indicative converted figure once rates load (USD)', async () => {
    renderInProvider(<IndicativeNote jpy={27000} />, 'en')
    // 27000 * 0.0067 = 180.9 -> "$181"
    await waitFor(() => expect(screen.getByText(/≈ \$181/)).toBeTruthy())
  })

  it('renders nothing for a JPY display currency so the caller shows JPY alone', async () => {
    localStorage.setItem('kuruma-display-currency', 'JPY')
    const { container } = renderInProvider(<IndicativeNote jpy={27000} />, 'ja')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('renders nothing when used outside a provider — degrades to JPY-only, never throws', () => {
    const { container } = render(<IndicativeNote jpy={27000} />)
    expect(container.textContent).toBe('')
  })
})
