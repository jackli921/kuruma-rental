import { FeatureFlagsProvider } from '@/vite/config'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { RatingBadge } from './RatingBadge'

// Proves REVIEWS is driven by the runtime override layer, not just the build-time
// env: a DB override wins over the baked-in default at the live UI. RatingBadge is
// the simplest consumer -- it renders the ★ badge only when the flag is effectively
// ON, so its presence/absence is a clean signal for the effective flag value.
function renderBadge(overrides: FeatureFlagOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], overrides)
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <RatingBadge entry={{ avg: 4.5, count: 12 }} />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('REVIEWS runtime override reaches the live UI', () => {
  it('a server override ON renders the badge even when the build default is OFF', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', '')
    renderBadge({ REVIEWS: true })
    expect(screen.getByText('★ 4.5 (12)')).toBeInTheDocument()
  })

  it('a server override OFF hides the badge even when the build default is ON', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderBadge({ REVIEWS: false })
    expect(screen.queryByText('★ 4.5 (12)')).toBeNull()
  })
})
