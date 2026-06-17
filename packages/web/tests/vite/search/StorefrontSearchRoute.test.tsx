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
  region: undefined as string | undefined,
}))

// Drive the build-time gate directly (the route's single source of truth) instead
// of stubbing import.meta.env — resolveResultView stays real.
vi.mock('@/vite/search/flags', async () => ({
  ...(await vi.importActual<typeof import('@/vite/search/flags')>('@/vite/search/flags')),
  isSearchMapEnabled: () => state.mapEnabled,
}))

// Hoisted captor: upgraded SearchMap mock records props so seam tests can assert
// the route forwarded the right values (regions, geoAnchor) without a full render.
const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

// Stand in for the heavy views + form — their own tests cover internals; here we
// only assert which view the route mounts and whether the toggle is gated.
vi.mock('@/vite/storefronts/StoreGrid', () => ({
  StoreGrid: () => <div data-testid="store-grid" />,
}))
vi.mock('@/vite/search/SearchMap', () => ({
  SearchMap: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-testid="search-map" />
  },
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
    useSearch: () => ({ from: '2026-07-01T10:00', to: '2026-07-03T10:00', region: state.region }),
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

function renderRoute(regions: unknown[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(regionsQueryOptions().queryKey, regions)
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
    state.region = undefined
    captured.props = null
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

  it('map gated off + forced view=map (stale loader data): render stays on the store list', () => {
    // Defense in depth: even if a future loader change leaked view='map' through with
    // the flag off, the render-site guard keeps the premium map from mounting (#885).
    state.mapEnabled = false
    state.view = 'map'
    renderRoute()

    expect(screen.getByTestId('store-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('search-map')).not.toBeInTheDocument()
  })

  it('forwards the region list and resolved anchor into the map (#885 slice 3a seam)', () => {
    const namba = {
      id: 'reg_namba',
      nameEn: 'Namba',
      nameJa: '難波',
      nameZh: '难波',
      type: 'AREA',
      slug: 'namba',
      parentId: null,
      assignable: true,
      status: 'ACTIVE',
      sortOrder: 1,
      latitude: 34.6627,
      longitude: 135.5023,
    }
    state.mapEnabled = true
    state.view = 'map'
    state.region = 'namba'
    renderRoute([namba])

    expect(Array.isArray(captured.props?.regions)).toBe(true)
    expect((captured.props?.regions as unknown[]).length).toBe(1)
    expect(captured.props?.geoAnchor).toEqual({ latitude: 34.6627, longitude: 135.5023 })
  })
})
