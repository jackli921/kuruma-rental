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
    search?: { from?: string; to?: string }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-locationid={params?.locationId}
      data-from={search?.from}
      data-rangeto={search?.to}
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

function renderCard(storefront: StorefrontCardData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <StorefrontCard storefront={storefront} from="2026-07-01T10:00" to="2026-07-03T10:00" />
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
})
