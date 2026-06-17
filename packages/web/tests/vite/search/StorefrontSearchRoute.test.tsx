import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Mutable harness state, hoisted so the vi.mock factories below can read it. Each
// test sets the build-time gate + the loader's resolved view, then renders.
const state = vi.hoisted(() => ({
  mapEnabled: false,
  view: 'stores' as 'stores' | 'map',
}))

// Drive the build-time gate directly (the route's single source of truth) instead
// of stubbing import.meta.env — resolveResultView stays real.
vi.mock('@/vite/search/flags', async () => ({
  ...(await vi.importActual<typeof import('@/vite/search/flags')>('@/vite/search/flags')),
  isSearchMapEnabled: () => state.mapEnabled,
}))

// Stand in for the heavy views + form — their own tests cover internals; here we
// only assert which view the route mounts and whether the toggle is gated.
vi.mock('@/vite/storefronts/StoreGrid', () => ({
  StoreGrid: () => <div data-testid="store-grid" />,
}))
vi.mock('@/vite/search/SearchMap', () => ({
  SearchMap: () => <div data-testid="search-map" />,
}))
vi.mock('@/vite/storefronts/StorefrontSearchForm', () => ({
  StorefrontSearchForm: () => <form data-testid="search-form" />,
}))

// Render the route component outside a RouterProvider: stub Route.use* via
// createFileRoute and Link -> anchor (the toggle renders Links).
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => () => ({
    useParams: () => ({ locale: 'en' }),
    useSearch: () => ({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' }),
    useLoaderData: () => ({ view: state.view, storefronts: null, flat: null }),
  }),
  Link: ({
    to,
    params: _p,
    search: _s,
    children,
    ...rest
  }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

// Imported after the mocks (vitest hoists vi.mock above imports).
import { StorefrontSearchRoute } from '@/routes/$locale/search'

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(regionsQueryOptions().queryKey, [])
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <StorefrontSearchRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('StorefrontSearchRoute — search map gating (#885 Task 0)', () => {
  afterEach(() => {
    state.mapEnabled = false
    state.view = 'stores'
  })

  it('beta (map gated off): renders the store list with no map and no view toggle', () => {
    state.mapEnabled = false
    state.view = 'stores'
    renderRoute()

    expect(screen.getByTestId('store-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('search-map')).not.toBeInTheDocument()
    // The Stores|Map data-mode toggle is hidden entirely in beta.
    expect(screen.queryByRole('link', { name: 'Map' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Stores' })).not.toBeInTheDocument()
  })

  it('map enabled: shows the view toggle alongside the store list', () => {
    state.mapEnabled = true
    state.view = 'stores'
    renderRoute()

    expect(screen.getByTestId('store-grid')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Stores' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Map' })).toBeInTheDocument()
  })

  it('map enabled + view=map: mounts the map view with the toggle', () => {
    state.mapEnabled = true
    state.view = 'map'
    renderRoute()

    expect(screen.getByTestId('search-map')).toBeInTheDocument()
    expect(screen.queryByTestId('store-grid')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Map' })).toBeInTheDocument()
  })
})
