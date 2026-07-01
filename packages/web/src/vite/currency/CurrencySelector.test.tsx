import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { CurrencyProvider } from './CurrencyProvider'
import { CurrencySelector, currencyOptions } from './CurrencySelector'

const rates: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067, CNY: 0.048 } }

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  // Multi-currency (#1070) ships OFF in beta; the picker only renders when ON. The
  // gated-off path is covered by its own test below.
  vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
  localStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: rates }),
  })
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

describe('currencyOptions', () => {
  it('lists JPY first, then the fetched rate currencies in order', () => {
    expect(currencyOptions(rates)).toEqual(['JPY', 'USD', 'CNY'])
  })

  it('offers JPY alone when rates have not loaded (degraded fetch)', () => {
    expect(currencyOptions(undefined)).toEqual(['JPY'])
  })

  it('never lists JPY twice if a provider ever includes it in rates', () => {
    expect(currencyOptions({ ...rates, rates: { JPY: 1, USD: 0.0067 } })).toEqual(['JPY', 'USD'])
  })
})

describe('CurrencySelector trigger', () => {
  function renderSelector(locale = 'en') {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale={locale} messages={en}>
          <CurrencyProvider>
            <CurrencySelector />
          </CurrencyProvider>
        </IntlProvider>
      </QueryClientProvider>,
    )
  }

  it('shows the active currency code (en defaults to USD)', () => {
    renderSelector('en')
    expect(screen.getByRole('button').textContent).toContain('USD')
  })

  it('reflects a stored override on the trigger', () => {
    localStorage.setItem('kuruma-display-currency', 'CNY')
    renderSelector('en')
    expect(screen.getByRole('button').textContent).toContain('CNY')
  })

  it('names the trigger with the translated label AND the visible code (WCAG 2.5.3)', () => {
    renderSelector('en')
    const label = screen.getByRole('button').getAttribute('aria-label') ?? ''
    expect(label).toContain(en.currency.label)
    expect(label).toContain('USD')
  })

  it('opens to the disclaimer, every currency option in order, the as-of date, and switches on click', async () => {
    renderSelector('en')
    fireEvent.click(screen.getByRole('button'))

    // The menu portals on open once rates have loaded — JPY first, then the snapshot.
    await waitFor(() =>
      expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
        'JPY',
        'USD',
        'CNY',
      ]),
    )
    expect(screen.getByText(en.currency.disclaimer)).toBeTruthy()
    expect(screen.getByText('Rates as of 2026-06-01')).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: 'CNY' }))
    expect(localStorage.getItem('kuruma-display-currency')).toBe('CNY')
  })

  it('renders nothing when multi-currency is gated off (#1070) — no picker at all', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', undefined)
    const { container } = renderSelector('en')
    // The whole navbar control disappears; JPY prices stand alone with no chooser.
    expect(screen.queryByRole('button')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})
