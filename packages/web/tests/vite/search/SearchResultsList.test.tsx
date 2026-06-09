import { SearchResultsList } from '@/vite/search/SearchResultsList'
import type { SearchResultsData, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function specific(id: string, name: string): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId: 'loc_namba',
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: 'Namba',
      address: '1-1 Namba',
      latitude: 34.6,
      longitude: 135.5,
    },
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    vehicleId: id,
    name,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
  }
}

function renderList(result: SearchResultsData | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchResultsList result={result} />
    </IntlProvider>,
  )
}

describe('SearchResultsList', () => {
  it('prompts for dates when no range has been chosen (result=null)', () => {
    renderList(null)
    expect(
      screen.getByText('Choose a pickup and return time to see available stores.'),
    ).toBeInTheDocument()
  })

  it('shows the flat empty state when no cars are free for the range', () => {
    renderList({ items: [], nextCursor: null })
    expect(screen.getByText('No cars are available for these dates.')).toBeInTheDocument()
  })

  it('renders one row per result item', () => {
    renderList({
      items: [specific('v1', 'Toyota Yaris'), specific('v2', 'Honda Fit')],
      nextCursor: null,
    })
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText('Honda Fit')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Select' })).toHaveLength(2)
  })
})
