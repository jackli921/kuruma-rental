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

  it('prefills both inputs with the next-hour pickup and +3 day return by default', () => {
    renderWidget()
    expect(screen.getByLabelText('Pickup date')).toHaveValue('2026-06-11T15:00')
    expect(screen.getByLabelText('Return date')).toHaveValue('2026-06-14T15:00')
  })

  it('restores the persisted range instead of the defaults when one exists', () => {
    persistSearchRange('2026-09-01T08:00', '2026-09-05T08:00')
    renderWidget()
    expect(screen.getByLabelText('Pickup date')).toHaveValue('2026-09-01T08:00')
    expect(screen.getByLabelText('Return date')).toHaveValue('2026-09-05T08:00')
  })

  it('persists the chosen range on submit so it survives leaving and returning', () => {
    renderWidget()
    fireEvent.change(screen.getByLabelText('Pickup date'), {
      target: { value: '2026-07-01T10:00' },
    })
    fireEvent.change(screen.getByLabelText('Return date'), {
      target: { value: '2026-07-03T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(readPersistedRange()).toEqual({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' })
  })

  it('renders the region picker, both date inputs, and the search button', () => {
    renderWidget()
    expect(screen.getByLabelText('Prefecture')).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup date')).toBeInTheDocument()
    expect(screen.getByLabelText('Return date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('navigates to the locale-scoped storefront search carrying the chosen range', () => {
    renderWidget()
    fireEvent.change(screen.getByLabelText('Pickup date'), {
      target: { value: '2026-07-01T10:00' },
    })
    fireEvent.change(screen.getByLabelText('Return date'), {
      target: { value: '2026-07-03T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00' },
    })
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
