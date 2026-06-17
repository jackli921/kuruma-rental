import type { MapAdapter } from '@/vite/search/MapAdapter'
import { SearchMapList } from '@/vite/search/SearchMapList'
import type { RegionNode } from '@kuruma/shared/types/region'
import type { SearchResultItem, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Each row now carries a detail-CTA Link (#885 1b); stub it as a plain anchor so
// the two-pane view renders without a RouterProvider and the carried search is
// inspectable.
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
      data-location={params?.locationId}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}))

// Fake adapter standing in for any map library: one `pin-<id>` slot per plotted
// item, filled by the view's `renderPin` (the price pill). Asserts the
// MapAdapterProps seam — no real tiles.
const FakeMapAdapter: MapAdapter = ({ items, selectedId, anchor, renderSelected, renderPin }) => {
  const selected = items.find((i) => i.location.locationId === selectedId) ?? null
  return (
    <div
      data-testid="fake-map"
      data-selected={selectedId ?? ''}
      data-anchor={anchor?.join(',') ?? ''}
    >
      {items.map((item) => (
        <div key={item.location.locationId} data-testid={`pin-${item.location.locationId}`}>
          {renderPin?.(item, { selected: item.location.locationId === selectedId })}
        </div>
      ))}
      {selected && renderSelected && <div data-testid="map-popup">{renderSelected(selected)}</div>}
    </div>
  )
}

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

function areaNode(o: Partial<RegionNode> & Pick<RegionNode, 'id'>): RegionNode {
  return {
    latitude: null,
    longitude: null,
    assignable: false,
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    nameEn: 'X',
    nameJa: 'X',
    nameZh: 'X',
    type: null,
    slug: null,
    ...o,
  }
}
const OSAKA_REGIONS: RegionNode[] = [
  areaNode({ id: 'reg_osaka', nameEn: 'Osaka', type: 'PREFECTURE', slug: 'osaka' }),
  areaNode({ id: 'reg_osaka_city', nameEn: 'Osaka City', type: 'CITY', parentId: 'reg_osaka' }),
  areaNode({
    id: 'reg_umeda',
    nameEn: 'Umeda',
    type: 'AREA',
    slug: 'umeda',
    parentId: 'reg_osaka_city',
    assignable: true,
    latitude: 34.7025,
    longitude: 135.4959,
    sortOrder: 1,
  }),
]

function renderMapList(
  items: SpecificSearchResult[],
  opts: {
    anchor?: [number, number] | null
    regions?: RegionNode[]
    geoAnchor?: { latitude: number; longitude: number } | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMapList
        items={items}
        adapter={FakeMapAdapter}
        anchor={opts.anchor}
        regions={opts.regions}
        geoAnchor={opts.geoAnchor ?? null}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
      />
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
    expect(screen.getByTestId('pin-loc_namba')).toBeInTheDocument()
    expect(screen.queryByTestId('pin-loc_umeda')).toBeNull()
  })

  it('dedups markers by location (two cars at one store → one pin)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_namba', GEOCODED),
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('fake-map').querySelectorAll('[data-testid^="pin-"]')).toHaveLength(1)
  })

  it('highlights the matching rows when a marker is clicked and feeds selectedId back to the adapter', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    fireEvent.click(within(screen.getByTestId('pin-loc_namba')).getByRole('button'))

    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    const umedaRow = rows.find((o) => o.textContent?.includes('Honda Fit'))
    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(umedaRow).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('selects a row from its accessible "show on map" control (row → marker sync)', async () => {
    const user = userEvent.setup()
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    if (!nambaRow) throw new Error('expected the Namba row')
    const showOnMap = within(nambaRow).getByRole('button', { name: /show on map/i })

    // Real focus→click order (userEvent): the button focuses first — which selects
    // the row via its onFocus — then the click lands. Idempotent-select keeps it on.
    await user.click(showOnMap)

    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('keeps the row selected when the "show on map" control is clicked again (idempotent select, not a toggle)', async () => {
    const user = userEvent.setup()
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const showOnMap = screen.getByRole('button', { name: /show on map/i })

    await user.click(showOnMap)
    await user.click(showOnMap)

    // The old toggle deselected here; combined with the row onFocus that made
    // focus-then-click flicker the selection off. Idempotent-select stays put.
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'true')
  })

  it('offers no "show on map" control for a list-only (null-coord) row', () => {
    renderMapList([carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS)])
    expect(screen.queryByRole('button', { name: /show on map/i })).toBeNull()
  })

  it('selects a geocoded row on hover (card-as-affordance)', async () => {
    const user = userEvent.setup()
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])
    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    if (!nambaRow) throw new Error('expected the Namba row')

    await user.hover(nambaRow)

    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('leaves a list-only (null-coord) row inert on hover', async () => {
    const user = userEvent.setup()
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])
    const rows = screen.getAllByRole('listitem')
    const umedaRow = rows.find((o) => o.textContent?.includes('Honda Fit'))
    if (!umedaRow) throw new Error('expected the Umeda row')

    await user.hover(umedaRow)

    expect(umedaRow).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', '')
  })

  it('selects the row when keyboard focus reaches its "View cars" link (keyboard parity, P2)', async () => {
    const user = userEvent.setup()
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])
    const rows = screen.getAllByRole('listitem')
    const nambaRow = rows.find((o) => o.textContent?.includes('Toyota Yaris'))
    if (!nambaRow) throw new Error('expected the Namba row')

    // Tab moves keyboard focus to the first control — Namba's real "View cars" link —
    // and the row's onFocus (focusin bubbles up from the CTA) selects its pin.
    await user.tab()

    expect(within(nambaRow).getByRole('link', { name: 'View cars' })).toHaveFocus()
    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('threads the region anchor through to the map adapter (#840)', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)], {
      anchor: [34.6655, 135.5023],
    })
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-anchor', '34.6655,135.5023')
  })

  it('opens a co-location carousel popup for the selected location', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    expect(screen.queryByTestId('map-popup')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /show on map/i }))

    const popup = screen.getByTestId('map-popup')
    expect(popup).toHaveTextContent('Toyota Yaris')
    expect(popup).toHaveTextContent(/8,000/)
    // One car at this store → a static card, no carousel arrows.
    expect(within(popup).queryByRole('button', { name: /next car/i })).toBeNull()
  })

  it('threads the whole co-located group into the popup carousel (not just the pin item)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_namba', GEOCODED),
    ])

    fireEvent.click(within(screen.getByTestId('pin-loc_namba')).getByRole('button'))

    const popup = screen.getByTestId('map-popup')
    expect(popup).toHaveTextContent('Toyota Yaris')
    expect(within(popup).getByText('1 / 2')).toBeInTheDocument()
    // The carousel cycles to the second co-located car — proof the group, not just
    // the representative pin item, was threaded into renderSelected.
    fireEvent.click(within(popup).getByRole('button', { name: /next car/i }))
    expect(popup).toHaveTextContent('Honda Fit')
  })

  it('opens a freshly selected pin at its first car, not the previous carousel position', async () => {
    const user = userEvent.setup()
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_namba', GEOCODED),
      carAt('v3', 'Mazda Demio', 'loc_umeda', GEOCODED),
      carAt('v4', 'Nissan Note', 'loc_umeda', GEOCODED),
    ])

    // Open Namba's popup and advance to its second car.
    fireEvent.click(within(screen.getByTestId('pin-loc_namba')).getByRole('button'))
    await user.click(
      within(screen.getByTestId('map-popup')).getByRole('button', { name: /next car/i }),
    )
    expect(screen.getByTestId('map-popup')).toHaveTextContent('2 / 2')

    // Switch to Umeda's pin: its popup must open at the first car. Without keying the
    // carousel to the location the stale index leaks and it opens mid-carousel.
    fireEvent.click(within(screen.getByTestId('pin-loc_umeda')).getByRole('button'))
    const popup = screen.getByTestId('map-popup')
    expect(within(popup).getByText('1 / 2')).toBeInTheDocument()
    expect(popup).toHaveTextContent('Mazda Demio')
  })

  it('plots a price-pill pin showing the bare price for a single-car location', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const pin = within(screen.getByTestId('pin-loc_namba')).getByRole('button')
    expect(pin).toHaveTextContent('¥8,000')
  })

  it('labels a multi-car pin "From ¥{min}" using the cheapest car in the group', () => {
    renderMapList([
      { ...carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED), dailyRateJpy: 8000 },
      { ...carAt('v2', 'Honda Fit', 'loc_namba', GEOCODED), dailyRateJpy: 6000 },
    ])
    const pin = within(screen.getByTestId('pin-loc_namba')).getByRole('button')
    expect(pin).toHaveTextContent('From ¥6,000')
  })

  it('selects a location when its price pin is clicked (pin → row sync)', () => {
    renderMapList([
      carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED),
      carAt('v2', 'Honda Fit', 'loc_umeda', NO_COORDS),
    ])

    fireEvent.click(within(screen.getByTestId('pin-loc_namba')).getByRole('button'))

    const nambaRow = screen
      .getAllByRole('listitem')
      .find((o) => o.textContent?.includes('Toyota Yaris'))
    expect(nambaRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('fake-map')).toHaveAttribute('data-selected', 'loc_namba')
  })

  it('gives each price pin an accessible name of store + price so identical prices stay distinguishable (P2)', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const pin = within(screen.getByTestId('pin-loc_namba')).getByRole('button')
    expect(pin).toHaveAccessibleName('Select Best Car Rental · Namba, ¥8,000')
  })

  it('marks the selected pin as current so it can invert its colors', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const pin = () => within(screen.getByTestId('pin-loc_namba')).getByRole('button')
    expect(pin()).not.toHaveAttribute('aria-current')

    fireEvent.click(pin())

    expect(pin()).toHaveAttribute('aria-current', 'true')
  })

  it('threads the search context into each row CTA so the date range survives the drill-down', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
    const cta = screen.getByRole('link', { name: 'View cars' })
    expect(cta).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(cta).toHaveAttribute('data-location', 'loc_namba')
    const search = JSON.parse(cta.getAttribute('data-search') ?? '{}')
    expect(search).toMatchObject({ from: '2026-07-01T10:00', to: '2026-07-04T10:00' })
  })

  it('labels a geocoded row with its area, prefecture, and distance from the anchor', () => {
    renderMapList(
      [carAt('v1', 'Toyota Yaris', 'loc_umeda', { latitude: 34.7025, longitude: 135.4959 })],
      {
        regions: OSAKA_REGIONS,
        geoAnchor: { latitude: 34.6627, longitude: 135.5023 }, // Namba centre
      },
    )
    // Umeda store, Namba anchor ~ a few km apart -> "Umeda, Osaka · X.X km away".
    expect(screen.getByText(/Umeda, Osaka · \d+\.\d+ km away/)).toBeInTheDocument()
  })

  it('carries the geo label into the selected map popup', () => {
    renderMapList(
      [carAt('v1', 'Toyota Yaris', 'loc_umeda', { latitude: 34.7025, longitude: 135.4959 })],
      {
        regions: OSAKA_REGIONS,
        geoAnchor: null,
      },
    )
    fireEvent.click(within(screen.getByTestId('pin-loc_umeda')).getByRole('button'))
    // No anchor -> place-only label, present in both the row and the popup.
    expect(screen.getAllByText('Umeda, Osaka').length).toBeGreaterThanOrEqual(2)
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
