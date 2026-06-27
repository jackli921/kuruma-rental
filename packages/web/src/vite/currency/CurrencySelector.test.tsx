import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { CurrencyProvider } from './CurrencyProvider'
import { CurrencySelector, currencyOptions } from './CurrencySelector'

const rates: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067, CNY: 0.048 } }

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

  it('carries a translated accessible label so the icon-only trigger is named', () => {
    renderSelector('en')
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(en.currency.label)
  })
})
