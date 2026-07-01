import { FeatureFlagsProvider } from '@/vite/config'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { CurrencyProvider } from './CurrencyProvider'
import { CurrencySelector } from './CurrencySelector'
import { FX_RATES_QUERY_KEY } from './currency-api'

const RATES: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }

// Proves MULTI_CURRENCY is now driven by the runtime override layer, not just the
// build-time env: a DB override wins over the baked-in default at the live UI. The
// CurrencySelector renders its picker button only when the flag is effectively ON.
function renderSelector(overrides: FeatureFlagOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], overrides)
  // Seed FX rates so the provider's snapshot query never hits the network.
  client.setQueryData(FX_RATES_QUERY_KEY, RATES)
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <CurrencyProvider>
            <CurrencySelector />
          </CurrencyProvider>
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('MULTI_CURRENCY runtime override reaches the live UI', () => {
  it('a server override ON reveals the picker even when the build default is OFF', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', '')
    renderSelector({ MULTI_CURRENCY: true })
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('a server override OFF hides the picker even when the build default is ON', () => {
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
    renderSelector({ MULTI_CURRENCY: false })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
