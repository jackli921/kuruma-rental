import { REGIONS_QUERY_KEY } from '@/vite/regions/regions-api'
import { StoreGrid } from '@/vite/storefronts/StoreGrid'
import type { StorefrontCardData, StorefrontSearchResultData } from '@/vite/storefronts/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
  }: { to: string; search?: { region?: string }; children: ReactNode }) => (
    <a href={to} data-region={search?.region}>
      {children}
    </a>
  ),
}))

function card(name: string, latitude: number | null, longitude: number | null): StorefrontCardData {
  return {
    locationId: name,
    operatorId: 'op',
    operatorName: 'Op',
    name,
    address: 'addr',
    operatingHours: null,
    turnaroundMinutes: 0,
    classSummaries: [],
    fromDailyPriceJpy: 4500,
    fromHourlyPriceJpy: null,
    representativePhotos: [],
    latitude,
    longitude,
  }
}

// Single assignable AREA anchor; only slug + coords are read by the grid.
const NAMBA = {
  id: 'namba',
  parentId: null,
  nameEn: 'Namba',
  nameJa: '難波',
  nameZh: '难波',
  sortOrder: 0,
  type: 'AREA' as const,
  slug: 'namba',
  latitude: 34.6655,
  longitude: 135.5023,
  assignable: true,
  status: 'ACTIVE' as const,
}

function renderGrid(result: StorefrontSearchResultData | null, region?: string, priceMax?: number) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  qc.setQueryData(REGIONS_QUERY_KEY, [NAMBA])
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <StoreGrid
          result={result}
          from="2026-07-01T10:00"
          to="2026-07-03T10:00"
          region={region}
          priceMax={priceMax}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

const FAR = card('Far Store', 35.01, 135.77) // ~Kyoto, ~40 km from Namba
const NEAR = card('Near Store', 34.67, 135.5) // ~0.5 km from Namba

describe('StoreGrid', () => {
  it('with a chosen region: re-orders nearest-first and labels every store its distance (#840)', () => {
    renderGrid({ storefronts: [FAR, NEAR], nextCursor: null }, 'namba')
    const order = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(order).toEqual(['Near Store', 'Far Store'])
    expect(screen.getAllByText(/ km$/)).toHaveLength(2)
  })

  it('forwards the chosen region into every card link so the drill-down keeps its context (#840)', () => {
    renderGrid({ storefronts: [NEAR, FAR], nextCursor: null }, 'namba')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('data-region', 'namba')
    }
  })

  it('with no region: keeps the API order and shows no distance labels (#840)', () => {
    renderGrid({ storefronts: [FAR, NEAR], nextCursor: null }, undefined)
    const order = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(order).toEqual(['Far Store', 'Near Store'])
    expect(screen.queryByText(/ km$/)).not.toBeInTheDocument()
  })

  it('renders the empty state when the region subtree has no stores', () => {
    renderGrid({ storefronts: [], nextCursor: null }, 'namba')
    expect(screen.getByText(en.search.empty)).toBeInTheDocument()
    expect(screen.queryByText(en.search.emptyPriceCap)).not.toBeInTheDocument()
  })

  it('shows the price-cap empty state, not the date hint, when the cap filters the page out (#1291)', () => {
    // Stores exist for these dates (¥4500), but every one exceeds the ¥3000 cap, so
    // the renter must be pointed at the cap above the grid — not told to try a later date.
    renderGrid({ storefronts: [NEAR, FAR], nextCursor: null }, 'namba', 3000)
    expect(screen.getByText(en.search.emptyPriceCap)).toBeInTheDocument()
    expect(screen.getByText(en.search.emptyPriceCapHint)).toBeInTheDocument()
    expect(screen.queryByText(en.search.emptyTurnaroundHint)).not.toBeInTheDocument()
  })

  it('prompts for dates when there is no result yet', () => {
    renderGrid(null, undefined)
    expect(screen.getByText(en.search.needDates)).toBeInTheDocument()
  })
})
