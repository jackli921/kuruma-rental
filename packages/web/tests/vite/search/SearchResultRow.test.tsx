import { SearchResultRow } from '@/vite/search/SearchResultRow'
import type {
  ClassComboSearchResult,
  SearchResultItem,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The detail CTA is a TanStack Link (#885 slice 1b); stub it as a plain anchor
// so the row renders without a RouterProvider, exposing its target + carried
// search params for assertion.
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
      data-locale={params?.locale}
      data-location={params?.locationId}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}))

function makeSpecific(overrides: Partial<SpecificSearchResult> = {}): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId: 'loc_namba',
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: 'Namba',
      address: '1-1 Namba, Osaka',
      latitude: 34.6627,
      longitude: 135.5023,
    },
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    vehicleId: 'veh_1',
    name: 'Toyota Yaris',
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
    ...overrides,
  }
}

function makeCombo(overrides: Partial<ClassComboSearchResult> = {}): ClassComboSearchResult {
  return {
    kind: 'CLASS_COMBO',
    location: {
      locationId: 'loc_kyoto',
      operatorId: 'op_zen',
      operatorName: 'Zen Rentals',
      name: 'Kyoto Station',
      address: '1 Karasuma, Kyoto',
      latitude: 34.9858,
      longitude: 135.7588,
    },
    dailyRateJpy: 12000,
    hourlyRateJpy: null,
    classLabel: 'SUV',
    acrissCode: 'IFAR',
    seats: 7,
    photos: [],
    classId: 'cls_suv',
    availableCount: 3,
    ...overrides,
  }
}

// Search context defaults so the CTA renders; individual tests override what they assert.
function renderRow(
  item: SearchResultItem,
  ctx: {
    locale?: string
    from?: string
    to?: string
    classFilter?: string | string[] | undefined
    pickupLocationId?: string | undefined
    region?: string | undefined
    geoLabel?: string | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchResultRow
        item={item}
        locale={ctx.locale ?? 'en'}
        from={ctx.from ?? '2026-07-01T10:00'}
        to={ctx.to ?? '2026-07-04T10:00'}
        classFilter={ctx.classFilter}
        pickupLocationId={ctx.pickupLocationId}
        region={ctx.region}
        geoLabel={ctx.geoLabel}
      />
    </IntlProvider>,
  )
}

describe('SearchResultRow', () => {
  it('renders a SPECIFIC car name, class, seats, transmission, and daily price', () => {
    renderRow(makeSpecific())
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('From ¥8,000 / day')).toBeInTheDocument()
  })

  it('shows the operator and pickup store so a cross-operator list is legible', () => {
    renderRow(makeSpecific())
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Namba')).toBeInTheDocument()
  })

  it('falls back to the hourly price when there is no daily rate', () => {
    renderRow(makeSpecific({ dailyRateJpy: null, hourlyRateJpy: 1200 }))
    expect(screen.getByText('From ¥1,200 / hour')).toBeInTheDocument()
  })

  it('shows the price-on-request label when neither rate is set', () => {
    renderRow(makeSpecific({ dailyRateJpy: null, hourlyRateJpy: null }))
    expect(screen.getByText('Price on request')).toBeInTheDocument()
  })

  it('gives the thumbnail explicit square dimensions when a photo is present', () => {
    renderRow(makeSpecific({ photos: ['https://cdn.example/yaris.jpg'] }))
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('width', '300')
    expect(img).toHaveAttribute('height', '300')
  })

  it('navigates to the pickup-store detail route via an explicit CTA, preserving the date range', () => {
    renderRow(makeSpecific(), { locale: 'en', from: '2026-07-01T10:00', to: '2026-07-04T10:00' })
    const cta = screen.getByRole('link', { name: 'View cars' })
    expect(cta).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(cta).toHaveAttribute('data-locale', 'en')
    expect(cta).toHaveAttribute('data-location', 'loc_namba')
    const search = JSON.parse(cta.getAttribute('data-search') ?? '{}')
    expect(search).toMatchObject({ from: '2026-07-01T10:00', to: '2026-07-04T10:00' })
  })

  it('carries the active class/region filters forward through the detail CTA (#499)', () => {
    renderRow(makeSpecific(), {
      classFilter: 'compact',
      region: 'namba',
      pickupLocationId: 'loc_x',
    })
    const search = JSON.parse(
      screen.getByRole('link', { name: 'View cars' }).getAttribute('data-search') ?? '{}',
    )
    expect(search).toMatchObject({ class: 'compact', region: 'namba', pickupLocationId: 'loc_x' })
  })

  it('renders the geo-context line when a label is provided', () => {
    renderRow(makeSpecific(), { geoLabel: 'Umeda, Osaka · 3.5 km away' })
    expect(screen.getByText('Umeda, Osaka · 3.5 km away')).toBeInTheDocument()
  })

  it('omits the geo-context line when no label is provided', () => {
    renderRow(makeSpecific(), { geoLabel: null })
    expect(screen.queryByText(/km away/)).toBeNull()
  })
})

describe('SearchResultRow (CLASS_COMBO)', () => {
  it('renders the class label as the title, plus availability, seats, and price', () => {
    renderRow(makeCombo())
    expect(screen.getByRole('heading', { name: 'SUV' })).toBeInTheDocument()
    expect(screen.getByText('3 available')).toBeInTheDocument()
    expect(screen.getByText('7 seats')).toBeInTheDocument()
    expect(screen.getByText('From ¥12,000 / day')).toBeInTheDocument()
  })

  it('omits the transmission line — a class spans both gearboxes', () => {
    renderRow(makeCombo())
    expect(screen.queryByText('Automatic')).toBeNull()
    expect(screen.queryByText('Manual')).toBeNull()
  })

  it('shows the operator and pickup store, like the SPECIFIC row', () => {
    renderRow(makeCombo())
    expect(screen.getByText('Zen Rentals')).toBeInTheDocument()
    expect(screen.getByText('Kyoto Station')).toBeInTheDocument()
  })

  it('navigates to the pickup-store detail via the View cars CTA, preserving dates + filters', () => {
    renderRow(makeCombo(), {
      from: '2026-07-01T10:00',
      to: '2026-07-04T10:00',
      classFilter: 'suv',
    })
    const cta = screen.getByRole('link', { name: 'View cars' })
    expect(cta).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(cta).toHaveAttribute('data-location', 'loc_kyoto')
    const search = JSON.parse(cta.getAttribute('data-search') ?? '{}')
    expect(search).toMatchObject({ from: '2026-07-01T10:00', to: '2026-07-04T10:00', class: 'suv' })
  })

  it('shows "Sold out" and drops the booking CTA when availableCount is 0', () => {
    renderRow(makeCombo({ availableCount: 0 }))
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.queryByText('0 available')).toBeNull()
    expect(screen.queryByRole('link', { name: 'View cars' })).toBeNull()
  })

  it('still shows the class label and store when sold out, so the listing stays legible', () => {
    renderRow(makeCombo({ availableCount: 0 }))
    expect(screen.getByRole('heading', { name: 'SUV' })).toBeInTheDocument()
    expect(screen.getByText('Zen Rentals')).toBeInTheDocument()
  })
})
