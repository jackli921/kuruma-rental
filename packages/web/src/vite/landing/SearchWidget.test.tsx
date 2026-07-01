import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { readPersistedRegion } from '../storefronts/storage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
// Avoid a real /regions fetch: the picker just needs an (empty) list.
vi.mock('@/vite/regions/regions-api', () => ({
  regionsQueryOptions: () => ({ queryKey: ['regions'], queryFn: async () => [] }),
}))

import { SearchWidget } from './SearchWidget'

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  return render(<SearchWidget />, { wrapper })
}

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('search form not found')
  fireEvent.submit(form)
}

beforeEach(() => navigate.mockReset())
afterEach(() => sessionStorage.clear())

describe('SearchWidget region retention', () => {
  it('restores the last region and carries it into the search on submit', () => {
    sessionStorage.setItem('kuruma.search.region', 'namba')
    const { container } = renderWidget()
    submit(container)
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/$locale/search',
        search: expect.objectContaining({ region: 'namba' }),
      }),
    )
  })

  it('persists the chosen region on submit so a return visit restores it', () => {
    sessionStorage.setItem('kuruma.search.region', 'kix')
    const { container } = renderWidget()
    // Clear after mount: only a persist-on-submit can bring the region back.
    sessionStorage.clear()
    submit(container)
    expect(readPersistedRegion()).toBe('kix')
  })

  it('searches everywhere (no region param) when none was ever chosen', () => {
    const { container } = renderWidget()
    submit(container)
    const call = navigate.mock.calls[0]?.[0]
    expect(call.search).not.toHaveProperty('region')
  })
})
