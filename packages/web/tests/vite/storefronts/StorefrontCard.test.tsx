import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import type { StorefrontCardData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { renderWithUsdIndicative } from '../../support/currency'

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
  extra: { distanceKm?: number | null; region?: string } = {},
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

  // #1070: the storefront's daily from-price carries an indicative conversion.
  it('converts the from-price for the indicative note', async () => {
    renderWithUsdIndicative(
      <StorefrontCard
        storefront={makeStorefront({ fromDailyPriceJpy: 30000 })}
        from="2026-07-01T10:00"
        to="2026-07-03T10:00"
      />,
    )
    // 30,000 -> $201
    expect(await screen.findByText(/≈ \$201/)).toBeTruthy()
  })
})
