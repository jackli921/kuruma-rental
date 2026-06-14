import { Hero } from '@/vite/landing/Hero'
import { REGIONS_QUERY_KEY } from '@/vite/regions/regions-api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Hero embeds SearchWidget, which reaches for TanStack navigation and the
// regions query; provide both so the widget mounts as it does in the app root.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

function renderHero() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Seed the cache so the region query resolves without a network call.
  queryClient.setQueryData(REGIONS_QUERY_KEY, [])
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <Hero />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('Hero', () => {
  it('renders the headline, subtitle, and the embedded search widget', () => {
    renderHero()
    expect(screen.getByText('Explore Japan at your own pace')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pick up a car in Osaka and drive anywhere. No approval wait, no hidden fees.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })
})
