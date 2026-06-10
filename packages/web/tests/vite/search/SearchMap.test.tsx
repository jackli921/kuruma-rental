import { SearchMap } from '@/vite/search/SearchMap'
import type { SearchResultsData, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The host injects the real PigeonMapAdapter → mock pigeon-maps so no tiles load.
vi.mock('pigeon-maps', () => ({
  Map: ({ children }: { children: ReactNode }) => <div data-testid="pigeon-map">{children}</div>,
  Marker: () => <button type="button" data-testid="marker" />,
}))

function specific(id: string, name: string): SpecificSearchResult {
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
    vehicleId: id,
    name,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
  }
}

function renderMap(result: SearchResultsData | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMap result={result} />
    </IntlProvider>,
  )
}

describe('SearchMap', () => {
  it('prompts for dates when no range is chosen (result=null)', () => {
    renderMap(null)
    expect(
      screen.getByText('Choose a pickup and return time to see available stores.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('pigeon-map')).toBeNull()
  })

  it('shows the empty state when nothing is free for the range', () => {
    renderMap({ items: [], nextCursor: null })
    expect(screen.getByText('No cars are available for these dates.')).toBeInTheDocument()
    expect(screen.queryByTestId('pigeon-map')).toBeNull()
  })

  it('renders the two-pane list + map once there are results', () => {
    renderMap({ items: [specific('v1', 'Toyota Yaris')], nextCursor: null })
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByTestId('pigeon-map')).toBeInTheDocument()
  })
})
