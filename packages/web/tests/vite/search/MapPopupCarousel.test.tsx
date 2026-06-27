import { MapPopupCarousel } from '@/vite/search/MapPopupCarousel'
import type {
  ClassComboSearchResult,
  SearchResultItem,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Stub the router Link as a plain anchor so the carried search is inspectable
// without a RouterProvider (mirrors SearchMapList.test.tsx).
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string; locationId?: string }
    search?: Record<string, unknown>
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-location={params?.locationId}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}))

function carAt(vehicleId: string, name: string): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId: 'loc_namba',
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: 'Namba',
      address: 'Osaka',
      latitude: 34.66,
      longitude: 135.5,
    },
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    vehicleId,
    name,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
  }
}

function comboAt(
  classId: string,
  classLabel: string,
  availableCount: number,
): ClassComboSearchResult {
  return {
    kind: 'CLASS_COMBO',
    location: {
      locationId: 'loc_namba',
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: 'Namba',
      address: 'Osaka',
      latitude: 34.66,
      longitude: 135.5,
    },
    dailyRateJpy: 6500,
    hourlyRateJpy: null,
    classLabel,
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    classId,
    availableCount,
  }
}

function renderCarousel(
  items: SearchResultItem[],
  ctx?: { classFilter?: string | string[]; region?: string; geoLabel?: string | null },
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <MapPopupCarousel
        items={items}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
        classFilter={ctx?.classFilter}
        region={ctx?.region}
        geoLabel={ctx?.geoLabel}
      />
    </IntlProvider>,
  )
}

describe('MapPopupCarousel', () => {
  it('shows a single car with no carousel controls', () => {
    renderCarousel([carAt('v1', 'Toyota Yaris')])

    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText(/8,000/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next car/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /previous car/i })).toBeNull()
  })

  it('cycles co-located cars with next/prev (wrapping) and shows the position', async () => {
    const user = userEvent.setup()
    renderCarousel([carAt('v1', 'Toyota Yaris'), carAt('v2', 'Honda Fit')])

    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next car/i }))
    expect(screen.getByText('Honda Fit')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    // Next on the last slide wraps to the first.
    await user.click(screen.getByRole('button', { name: /next car/i }))
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    // Prev on the first slide wraps to the last.
    await user.click(screen.getByRole('button', { name: /previous car/i }))
    expect(screen.getByText('Honda Fit')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('announces the active car via a polite live region so advancing is not silent for screen readers', async () => {
    const user = userEvent.setup()
    renderCarousel([carAt('v1', 'Toyota Yaris'), carAt('v2', 'Honda Fit')])

    // The car details sit in an aria-live region: clicking next swaps the card in
    // place, so without it a SR user hears nothing about which car they landed on.
    const live = screen.getByText('Toyota Yaris').closest('[aria-live="polite"]')
    expect(live).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /next car/i }))
    expect(live).toHaveTextContent('Honda Fit')
  })

  it('carries from/to and filters into whichever slide is visible', async () => {
    const user = userEvent.setup()
    renderCarousel([carAt('v1', 'Toyota Yaris'), carAt('v2', 'Honda Fit')], {
      classFilter: 'COMPACT',
      region: 'osaka',
    })
    const ctaSearch = () =>
      JSON.parse(
        screen.getByRole('link', { name: 'View cars' }).getAttribute('data-search') ?? '{}',
      )

    expect(ctaSearch()).toMatchObject({
      from: '2026-07-01T10:00',
      to: '2026-07-04T10:00',
      class: 'COMPACT',
      region: 'osaka',
    })

    await user.click(screen.getByRole('button', { name: /next car/i }))
    expect(ctaSearch()).toMatchObject({
      from: '2026-07-01T10:00',
      to: '2026-07-04T10:00',
      class: 'COMPACT',
    })
  })

  it('targets the pickup store detail page for the current car', () => {
    renderCarousel([carAt('v1', 'Toyota Yaris')])
    const cta = screen.getByRole('link', { name: 'View cars' })

    expect(cta).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(cta).toHaveAttribute('data-location', 'loc_namba')
  })

  it('renders the geo-context line when a label is provided', () => {
    renderCarousel([carAt('v1', 'Toyota Yaris')], { geoLabel: 'Namba, Osaka · 1.2 km away' })
    expect(screen.getByText('Namba, Osaka · 1.2 km away')).toBeInTheDocument()
  })

  it('marks a CLASS_COMBO slide as a class deal with its inventory count (#464)', () => {
    renderCarousel([comboAt('class_compact', 'Compact', 3)])
    // The class label is the title; the badge says "class deal" (not a redundant
    // second copy of the label), and the live availability count stands in for a
    // single car's identity.
    // The label appears exactly once (the title) — the badge reads "Class deal",
    // not a redundant second copy of the class label.
    expect(screen.getAllByText('Compact')).toHaveLength(1)
    expect(screen.getByText('Class deal')).toBeInTheDocument()
    expect(screen.getByText('3 cars available')).toBeInTheDocument()
  })
})
