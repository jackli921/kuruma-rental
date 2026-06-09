import { SearchResultRow } from '@/vite/search/SearchResultRow'
import type { SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

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

function renderRow(item: SpecificSearchResult) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchResultRow item={item} />
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

  it('renders the select CTA as an inert disabled button (booking deferred)', () => {
    renderRow(makeSpecific())
    const select = screen.getByRole('button', { name: 'Select' })
    expect(select).toBeDisabled()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
