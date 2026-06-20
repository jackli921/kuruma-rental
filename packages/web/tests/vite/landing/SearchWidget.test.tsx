import { SearchWidget } from '@/vite/landing/SearchWidget'
import { REGIONS_QUERY_KEY } from '@/vite/regions/regions-api'
import { persistSearchRange, readPersistedRange } from '@/vite/storefronts/storage'
import type { RegionNode } from '@kuruma/shared/types/region'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))

function makeRegion(overrides: Pick<RegionNode, 'id' | 'slug'> & Partial<RegionNode>): RegionNode {
  return {
    parentId: null,
    nameEn: 'Region',
    nameJa: '地域',
    nameZh: '地区',
    type: 'AREA',
    latitude: null,
    longitude: null,
    assignable: true,
    status: 'ACTIVE',
    sortOrder: 0,
    ...overrides,
  }
}

const REGIONS: RegionNode[] = [
  makeRegion({ id: 'reg_osaka', slug: 'osaka', type: 'PREFECTURE', nameEn: 'Osaka' }),
  makeRegion({
    id: 'reg_osaka_city',
    slug: 'osaka-city',
    type: 'CITY',
    nameEn: 'Osaka City',
    parentId: 'reg_osaka',
  }),
  makeRegion({ id: 'reg_namba', slug: 'namba', nameEn: 'Namba', parentId: 'reg_osaka_city' }),
]

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(REGIONS_QUERY_KEY, REGIONS)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <SearchWidget />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('SearchWidget', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    // 05:37 UTC = 14:37 JST -> default pickup ceils to 15:00 JST.
    vi.setSystemTime(new Date('2026-06-11T05:37:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
    mockNavigate.mockClear()
    cleanup()
  })

  it('seeds the picker with the next-hour pickup and +3 day return by default', () => {
    renderWidget()
    expect(screen.getByText(/Jun 11 15:00 → Jun 14 15:00/)).toBeInTheDocument()
  })

  it('restores the persisted range instead of the defaults when one exists', () => {
    persistSearchRange('2026-09-01T08:00', '2026-09-05T08:00')
    renderWidget()
    expect(screen.getByText(/Sep 1 08:00 → Sep 5 08:00/)).toBeInTheDocument()
  })

  it('persists the seeded range on submit so it survives leaving and returning', () => {
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(readPersistedRange()).toEqual({ from: '2026-06-11T15:00', to: '2026-06-14T15:00' })
  })

  it('renders the region picker, the date-time picker, and the search button', () => {
    renderWidget()
    expect(screen.getByLabelText('Prefecture')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('navigates to the locale-scoped storefront search carrying the seeded range', () => {
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-06-11T15:00', to: '2026-06-14T15:00' },
    })
    // No anchor chosen → carryForwardFilters strips region; guard that no region
    // key leaks. toHaveBeenCalledWith treats an explicit `region: undefined` as
    // absent, so a regression dropping carryForwardFilters would pass without this.
    expect(mockNavigate.mock.calls[0]?.[0].search).not.toHaveProperty('region')
  })

  it('threads the chosen region slug through the search navigation', () => {
    renderWidget()
    // A quick-pick chip anchors the region; dates keep the pinned defaults.
    fireEvent.click(screen.getByRole('button', { name: 'Namba' }))
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-06-11T15:00', to: '2026-06-14T15:00', region: 'namba' },
    })
  })
})
