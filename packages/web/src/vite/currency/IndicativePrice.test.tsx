import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyProvider } from './CurrencyProvider'
import { IndicativePrice } from './IndicativePrice'

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

describe('IndicativePrice', () => {
  it('always shows the authoritative JPY figure', () => {
    // Assert on the grouped digits, not the ¥ glyph — the ICU yen sign differs
    // between runtimes (half- vs full-width), but the figure does not.
    const { container } = renderInProvider(<IndicativePrice jpy={27000} />, 'en')
    expect(container.textContent).toContain('27,000')
  })

  it('appends the indicative converted figure once rates load (USD)', async () => {
    renderInProvider(<IndicativePrice jpy={27000} />, 'en')
    await waitFor(() => expect(screen.getByText(/≈ \$181/)).toBeTruthy())
  })

  it('shows JPY alone — no indicative figure — for a JPY display currency', async () => {
    localStorage.setItem('kuruma-display-currency', 'JPY')
    renderInProvider(<IndicativePrice jpy={27000} />, 'ja')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText(/≈/)).toBeNull()
  })
})
