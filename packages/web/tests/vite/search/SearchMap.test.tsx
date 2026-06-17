import { SearchMap } from '@/vite/search/SearchMap'
import type { SearchResultsData, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The host injects the real PigeonMapAdapter → mock pigeon-maps so no tiles load.
// The adapter drives the viewport with controlled `center`/`zoom` (#885 slice 2),
// and positions price pills + the selected popup in <Overlay>s.
vi.mock('pigeon-maps', () => ({
  Map: ({ children, center }: { children: ReactNode; center?: [number, number] }) => (
    <div data-testid="pigeon-map" data-center={center ? center.join(',') : ''}>
      {children}
    </div>
  ),
  Marker: () => <button type="button" data-testid="marker" />,
  Overlay: ({ children }: { children: ReactNode }) => <div data-testid="overlay">{children}</div>,
}))

// Rows carry a detail-CTA Link (#885 1b); stub it so the host renders router-free.
// Drop the router-only props (to/params/search) so they never reach the DOM <a>.
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode
    to?: string
    params?: unknown
    search?: unknown
  }) => (
    <a href={typeof to === 'string' ? to : undefined} {...rest}>
      {children}
    </a>
  ),
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

function renderMap(result: SearchResultsData | null, anchor?: [number, number] | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMap
        result={result}
        anchor={anchor}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
      />
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

  it('centers the map on the chosen region anchor (#840)', () => {
    // The result pin is loc_namba at 34.66,135.5; the anchor differs, so a match
    // proves the host forwarded the region anchor down to the map, not the pin fit.
    renderMap({ items: [specific('v1', 'Toyota Yaris')], nextCursor: null }, [34.6655, 135.5023])
    expect(screen.getByTestId('pigeon-map')).toHaveAttribute('data-center', '34.6655,135.5023')
  })
})
