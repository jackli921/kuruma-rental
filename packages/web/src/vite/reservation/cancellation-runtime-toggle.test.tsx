import { FeatureFlagsProvider } from '@/vite/config'
import { ConfirmStep } from '@/vite/reservation/ConfirmStep'
import type { ReservationAddOn } from '@/vite/reservation/api'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const addOns: ReservationAddOn[] = [
  { id: 'a1', name: 'Baby seat', description: null, priceJpy: 2000 },
]

// Proves CANCELLATION is driven by the runtime override layer, not just the
// build-time env: a DB override wins over the baked-in default at the live UI.
// ConfirmStep renders the cancellation-policy schedule only when the flag is
// effectively ON, so the heading's presence is a clean signal for the flag value.
function renderStep(overrides: FeatureFlagOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], overrides)
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <ConfirmStep
            estimate={{ baseJpy: 16000, insuranceJpy: 3000, totalJpy: 21000 }}
            selectedAddOns={addOns}
            insuranceName="Full coverage"
            pickupAt={new Date('2026-12-01T10:00:00Z')}
          />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CANCELLATION runtime override reaches the live UI', () => {
  it('a server override ON shows the cancellation policy even when the build default is OFF', () => {
    vi.stubEnv('VITE_FEATURE_CANCELLATION', 'false')
    renderStep({ CANCELLATION: true })
    expect(screen.getByRole('heading', { name: 'Cancellation policy' })).toBeInTheDocument()
  })

  it('a server override OFF hides the cancellation policy even when the build default is ON', () => {
    vi.stubEnv('VITE_FEATURE_CANCELLATION', 'true')
    renderStep({ CANCELLATION: false })
    expect(screen.queryByRole('heading', { name: 'Cancellation policy' })).toBeNull()
  })
})
