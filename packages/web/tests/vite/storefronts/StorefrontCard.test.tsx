import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import type { StorefrontCardData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string
    params?: { locale?: string; locationId?: string }
    search?: { from?: string; to?: string; region?: string }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-locationid={params?.locationId}
      data-from={search?.from}
      data-rangeto={search?.to}
      data-region={search?.region}
    >
      {children}
    </a>
  ),
}))

function makeStorefront(overrides: Partial<StorefrontCardData> = {}): StorefrontCardData {
  return {
    locationId: 'loc-1',
    operatorId: 'op-1',
    operatorName: 'Best Car Rental',
    name: 'Best Car Rental Osaka',
    address: '1-2-3 Namba, Osaka',
    operatingHours: null,
    turnaroundMinutes: 120,
    classSummaries: [{ acrissCode: null, label: 'Compact', availableCount: 4 }],
    fromDailyPriceJpy: 4500,
    fromHourlyPriceJpy: null,
    representativePhotos: [],
    ...overrides,
  }
}

function renderCard(
  storefront: StorefrontCardData,
  extra: {
    distanceKm?: number | null
    region?: string
    operatorRating?: { avg: number; count: number } | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <StorefrontCard
        storefront={storefront}
        from="2026-07-01T10:00"
        to="2026-07-03T10:00"
        {...extra}
      />
    </IntlProvider>,
  )
}

describe('StorefrontCard', () => {
  it('renders the store identity, class summary, and daily from-price', () => {
    renderCard(makeStorefront())
    expect(screen.getByText('Best Car Rental Osaka')).toBeInTheDocument()
    expect(screen.getByText('Best Car Rental')).toBeInTheDocument()
    expect(screen.getByText('Compact ×4')).toBeInTheDocument()
    expect(screen.getByText('From ¥4,500 / day')).toBeInTheDocument()
  })

  it('surfaces the turnaround buffer as hours between rentals (#551)', () => {
    renderCard(makeStorefront({ turnaroundMinutes: 90 }))
    expect(screen.getByText('~1.5h turnaround between rentals')).toBeInTheDocument()
  })

  it('falls back to the hourly from-price when no daily price exists', () => {
    renderCard(makeStorefront({ fromDailyPriceJpy: null, fromHourlyPriceJpy: 1200 }))
    expect(screen.getByText('From ¥1,200 / hour')).toBeInTheDocument()
  })

  it('links to the locale-scoped storefront detail carrying the date range', () => {
    renderCard(makeStorefront())
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(link).toHaveAttribute('data-locationid', 'loc-1')
    expect(link).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(link).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
  })

  it('carries the chosen region slug into the detail link so it survives the drill-down (#840)', () => {
    renderCard(makeStorefront(), { region: 'namba' })
    expect(screen.getByRole('link')).toHaveAttribute('data-region', 'namba')
  })

  it('omits the region param from the detail link when no region is chosen (#840)', () => {
    renderCard(makeStorefront())
    expect(screen.getByRole('link')).not.toHaveAttribute('data-region')
  })

  it('shows the great-circle distance label, rounded to one decimal, when a distance is given (#840)', () => {
    renderCard(makeStorefront(), { distanceKm: 2.14 })
    expect(screen.getByText('~2.1 km')).toBeInTheDocument()
  })

  it('omits the distance label when no anchor distance is provided (#840)', () => {
    renderCard(makeStorefront(), { distanceKm: null })
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument()
  })

  it('never renders a vehicle photo as the store hero, even when photos exist (#955)', () => {
    const { container } = renderCard(makeStorefront({ representativePhotos: ['/photos/car.jpg'] }))
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows a store/location placeholder with an accessible label instead of a car photo (#955)', () => {
    renderCard(makeStorefront({ representativePhotos: ['/photos/car.jpg'] }))
    expect(screen.getByRole('img', { name: 'Store location' })).toBeInTheDocument()
  })

  it('renders a skeleton operator-rating badge while the parent batch is in flight (#1085)', () => {
    // Default — no operatorRating prop ⇒ `undefined` ⇒ skeleton, not "no reviews".
    renderCard(makeStorefront())
    expect(screen.getByTestId('rating-badge-skeleton')).toBeInTheDocument()
    expect(screen.queryByText(/no reviews/i)).toBeNull()
  })

  it('renders the operator rating once the batch resolves (#1085)', () => {
    renderCard(makeStorefront(), { operatorRating: { avg: 4.7, count: 23 } })
    // Pin the exact glyph + count so a regression to "(23 reviews)" or omitting
    // the star fails. The a11y label is the spelled-out form.
    expect(screen.getByText('★ 4.7 (23)')).toBeInTheDocument()
    expect(screen.getByLabelText('4.7 stars, 23 reviews')).toBeInTheDocument()
  })

  it('renders the "no reviews yet" badge when the batch returns null for this operator (#1085)', () => {
    renderCard(makeStorefront(), { operatorRating: null })
    expect(screen.getByLabelText('No reviews yet')).toBeInTheDocument()
    // null is distinct from in-flight — skeleton MUST NOT also be present.
    expect(screen.queryByTestId('rating-badge-skeleton')).toBeNull()
  })
})
