import type { MapAdapter } from '@/vite/search/MapAdapter'
import { SearchMapList } from '@/vite/search/SearchMapList'
import type { SearchResultItem, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

// Fake adapter standing in for any map library: one button per plotted item,
// click → onSelect(locationId). Asserts the MapAdapterProps seam — no real tiles.
const FakeMapAdapter: MapAdapter = ({ items, selectedId, onSelect, anchor }) => (
  <div
    data-testid="fake-map"
    data-selected={selectedId ?? ''}
    data-anchor={anchor?.join(',') ?? ''}
  >
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

function renderMapList(items: SpecificSearchResult[], anchor?: [number, number] | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMapList items={items} adapter={FakeMapAdapter} anchor={anchor} />
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

  it('selects a row from its accessible "show on map" control (row → marker sync)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    if (!nambaRow) throw new Error('expected the Namba row')
    const showOnMap = within(nambaRow).getByRole('button', { name: /show on map/i })

    fireEvent.click(showOnMap)

    expect(showOnMap).toHaveAttribute('aria-pressed', 'true')
    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('toggles the selection off when the pressed control is clicked again', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const showOnMap = screen.getByRole('button', { name: /show on map/i })

    fireEvent.click(showOnMap)
    fireEvent.click(showOnMap)

    expect(showOnMap).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', '')
  })

  it('offers no "show on map" control for a list-only (null-coord) row', () => {
    renderMapList([carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS)])
    expect(screen.queryByRole('button', { name: /show on map/i })).toBeNull()
  })

  it('threads the region anchor through to the map adapter (#840)', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)], [34.6655, 135.5023])
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-anchor', '34.6655,135.5023')
  })

  it('does not rebuild the plotted array on a selection-only re-render (#737)', () => {
    const seen: SearchResultItem[][] = []
    const CapturingAdapter: MapAdapter = ({ items, selectedId, onSelect }) => {
      // Record the array reference handed to the adapter on every render.
      seen.push(items)
      return (
        <div data-selected={selectedId ?? ''}>
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
    }
    render(
      <IntlProvider locale="en" messages={en}>
        <SearchMapList
          items={[carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)]}
          adapter={CapturingAdapter}
        />
      </IntlProvider>,
    )

    const rendersBefore = seen.length
    // Selection-only state change: selectedId flips, the items prop is untouched.
    fireEvent.click(screen.getByTestId('marker-loc_namba'))

    expect(seen.length).toBeGreaterThan(rendersBefore) // a re-render did happen
    expect(new Set(seen).size).toBe(1) // ...but geocodedByLocation was not re-run
  })
})
