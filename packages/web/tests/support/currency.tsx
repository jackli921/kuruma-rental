import { CurrencyProvider } from '@/vite/currency'
import { FX_RATES_QUERY_KEY } from '@/vite/currency/currency-api'
import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { IntlProvider } from 'use-intl'
import en from '../../messages/en.json'

// Deterministic (not real) rate: 30,000 JPY -> $201, so round-number price fixtures
// land on clean dollar figures the per-surface wiring tests can assert exactly.
const USD_PER_JPY = 0.0067
const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: USD_PER_JPY } }

/**
 * Render `ui` with USD as the display currency and the FX snapshot pre-seeded into
 * the query cache (fresh, so React Query never hits the network). An <IndicativeNote/>
 * inside `ui` therefore resolves its `≈ $…` figure synchronously. Used by the #1070
 * per-surface tests that pin each surface to the correct JPY field.
 */
export function renderWithUsdIndicative(ui: ReactElement): RenderResult {
  // Own the one key we read: overwrite the display-currency outright so the result never
  // depends on a value a sibling test left behind (order-independent under any shard).
  // Don't `clear()` — that would wipe unrelated keys a consuming test may have seeded.
  localStorage.setItem('kuruma-display-currency', 'USD')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(FX_RATES_QUERY_KEY, RATES)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <CurrencyProvider>{ui}</CurrencyProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}
