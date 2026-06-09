import type { MapAdapter } from '@/vite/search/MapAdapter'
import { SearchMapList } from '@/vite/search/SearchMapList'
import type { SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

// Fake adapter standing in for any map library: one button per plotted item,
// click → onSelect(locationId). Asserts the MapAdapterProps seam — no real tiles.
const FakeMapAdapter: MapAdapter = ({ items, selectedId, onSelect }) => (
  <div data-testid="fake-map" data-selected={selectedId ?? ''}>
    {items.map((item) => (
      <button
        key={item.location.locationId}
        type="button"
        data-testid={`marker-${item.location.locationId}`}
        onClick={() => onSelect(item.location.locationId)}
      >
        marker
      </button>
    ))}
  </div>
)

function carAt(
  vehicleId: string,
  name: string,
  locationId: string,
  coords: { latitude: number | null; longitude: number | null },
): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId,
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: locationId === 'loc_namba' ? 'Namba' : 'Umeda',
      address: 'Osaka',
      latitude: coords.latitude,
      longitude: coords.longitude,
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

function renderMapList(items: SpecificSearchResult[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMapList items={items} adapter={FakeMapAdapter} />
    </IntlProvider>,
  )
}

const GEOCODED = { latitude: 34.66, longitude: 135.5 }
const NO_COORDS = { latitude: null, longitude: null }

describe('SearchMapList', () => {
  it('lists every row but only plots geocoded locations (null-coord = list-only)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('marker-loc_namba')).toBeInTheDocument()
    expect(screen.queryByTestId('marker-loc_umeda')).toBeNull()
  })

  it('dedups markers by location (two cars at one store → one marker)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_namba', GEOCODED),
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('fake-map').querySelectorAll('button')).toHaveLength(1)
  })

  it('highlights the matching rows when a marker is clicked and feeds selectedId back to the adapter', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    fireEvent.click(screen.getByTestId('marker-loc_namba'))

    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    const umedaRow = rows.find((o) => o.textContent?.includes('Honda Fit'))
    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(umedaRow).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })
})
