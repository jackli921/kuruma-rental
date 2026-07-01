import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrencyProvider, useCurrency, useIndicative } from './CurrencyProvider'

const STORAGE_KEY = 'kuruma-display-currency'

const rates: FxRates = {
  base: 'JPY',
  asOf: '2026-06-01',
  rates: { USD: 0.0067, CNY: 0.048 },
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  // Multi-currency (#1070) ships OFF in beta; ON is the precondition for every
  // conversion here. The gated-off path is covered by its own test below.
  vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
  localStorage.clear()
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: rates }))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

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

describe('CurrencyProvider currency preference', () => {
  it('defaults to the locale-inferred currency (en -> USD) when nothing is stored', () => {
    function Probe() {
      return <span>{useCurrency().currency}</span>
    }
    renderInProvider(<Probe />, 'en')
    expect(screen.getByText('USD')).toBeTruthy()
  })

  it('reads a stored currency on the very first render — no default flash', () => {
    localStorage.setItem(STORAGE_KEY, 'EUR')
    const seen: string[] = []
    function Probe(): null {
      seen.push(useCurrency().currency)
      return null
    }
    renderInProvider(<Probe />, 'en')
    expect(seen[0]).toBe('EUR')
    expect(seen).not.toContain('USD')
  })

  it('setCurrency updates the value and persists it to localStorage', () => {
    function Switcher() {
      const { currency, setCurrency } = useCurrency()
      return (
        <button type="button" onClick={() => setCurrency('CNY')}>
          {currency}
        </button>
      )
    }
    renderInProvider(<Switcher />, 'en')
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('USD')

    fireEvent.click(button)

    expect(button.textContent).toBe('CNY')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('CNY')
  })

  it('tracks the locale for the default until the renter picks a currency', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Probe() {
      return <span data-testid="cur">{useCurrency().currency}</span>
    }
    function Tree({ locale }: { locale: string }) {
      return (
        <QueryClientProvider client={queryClient}>
          <IntlProvider locale={locale} messages={{}}>
            <CurrencyProvider>
              <Probe />
            </CurrencyProvider>
          </IntlProvider>
        </QueryClientProvider>
      )
    }
    const { rerender } = render(<Tree locale="en" />)
    expect(screen.getByTestId('cur').textContent).toBe('USD')

    // Switch language WITHOUT remounting the provider — the unset default re-tracks
    // the locale (regression: it used to freeze at the first-mount locale).
    rerender(<Tree locale="ja" />)
    expect(screen.getByTestId('cur').textContent).toBe('JPY')
  })

  it('a stored choice still wins over the locale default after a locale switch', () => {
    localStorage.setItem(STORAGE_KEY, 'CNY')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Probe() {
      return <span data-testid="cur">{useCurrency().currency}</span>
    }
    function Tree({ locale }: { locale: string }) {
      return (
        <QueryClientProvider client={queryClient}>
          <IntlProvider locale={locale} messages={{}}>
            <CurrencyProvider>
              <Probe />
            </CurrencyProvider>
          </IntlProvider>
        </QueryClientProvider>
      )
    }
    const { rerender } = render(<Tree locale="en" />)
    expect(screen.getByTestId('cur').textContent).toBe('CNY')
    rerender(<Tree locale="ja" />)
    expect(screen.getByTestId('cur').textContent).toBe('CNY')
  })
})

describe('useIndicative', () => {
  it('formats the JPY amount in the selected currency once rates load', async () => {
    function Probe() {
      return <span data-testid="ind">{useIndicative().format(27000) ?? 'none'}</span>
    }
    renderInProvider(<Probe />, 'en')
    // 27000 * 0.0067 = 180.9 -> "$181"
    await waitFor(() => expect(screen.getByTestId('ind').textContent).toBe('$181'))
  })

  it('returns null for a JPY display currency so the caller shows JPY alone', async () => {
    localStorage.setItem(STORAGE_KEY, 'JPY')
    function Probe() {
      return <span data-testid="ind">{useIndicative().format(27000) ?? 'none'}</span>
    }
    renderInProvider(<Probe />, 'ja')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByTestId('ind').textContent).toBe('none')
  })

  it('normalizes a lower-case stored code so its rate still resolves', async () => {
    // A tampered/legacy 'usd' must not silently miss the upper-case 'USD' rate key.
    localStorage.setItem(STORAGE_KEY, 'usd')
    function Probe() {
      return <span data-testid="ind">{useIndicative().format(27000) ?? 'none'}</span>
    }
    renderInProvider(<Probe />, 'en')
    await waitFor(() => expect(screen.getByTestId('ind').textContent).toBe('$181'))
  })

  it('gated off (#1070) returns null from format AND skips the FX fetch entirely', async () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', undefined)
    function Probe() {
      // USD would otherwise convert to "$181"; gated off it must show JPY alone.
      return <span data-testid="ind">{useIndicative().format(27000) ?? 'none'}</span>
    }
    renderInProvider(<Probe />, 'en')
    // No conversion, and no reason to pay for the snapshot — the query stays disabled.
    await waitFor(() => expect(screen.getByTestId('ind').textContent).toBe('none'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
