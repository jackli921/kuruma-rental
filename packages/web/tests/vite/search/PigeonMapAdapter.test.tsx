import { PigeonMapAdapter, gsiTileProvider } from '@/vite/search/PigeonMapAdapter'
import type { SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

// Mock pigeon-maps → no real tiles in happy-dom. Assert the adapter's mapping of
// props → <Marker> components (the design's seam) plus the tile `provider` +
// `attribution` it configures (#660). The fake Map calls `provider` with a sample
// z/x/y so the test can read back the URL the real library would request.
vi.mock('pigeon-maps', () => ({
  Map: ({
    children,
    provider,
    attribution,
    center,
    zoom,
    onBoundsChanged,
  }: {
    children: ReactNode
    provider?: (x: number, y: number, z: number) => string
    attribution?: ReactNode
    center?: [number, number]
    zoom?: number
    onBoundsChanged?: (state: {
      center: [number, number]
      zoom: number
      bounds: { ne: [number, number]; sw: [number, number] }
      initial: boolean
    }) => void
  }) => (
    <div
      data-testid="pigeon-map"
      data-tile-url={provider ? provider(3, 5, 12) : ''}
      data-center={center ? center.join(',') : ''}
      data-zoom={zoom ?? ''}
    >
      {attribution}
      {/* Controlled-mode sync: the real lib reports viewport moves (incl. user
          pan/zoom) here, debounced 60ms. Tests fire it to assert the adapter folds
          a manual pan into state without remounting. */}
      <button
        type="button"
        data-testid="pan-map"
        onClick={() =>
          onBoundsChanged?.({
            center: [10, 10],
            zoom: 5,
            bounds: { ne: [11, 11], sw: [9, 9] },
            initial: false,
          })
        }
      />
      {children}
    </div>
  ),
  Marker: ({
    anchor,
    onClick,
    color,
  }: {
    anchor: [number, number]
    onClick?: (e: unknown) => void
    color?: string
  }) => (
    <button
      type="button"
      data-testid="marker"
      data-anchor={anchor.join(',')}
      data-color={color}
      onClick={() => onClick?.({})}
    />
  ),
  Overlay: ({ children, anchor }: { children: ReactNode; anchor: [number, number] }) => (
    <div data-testid="overlay" data-anchor={anchor.join(',')}>
      {children}
    </div>
  ),
}))

function carAt(
  locationId: string,
  coords: { latitude: number | null; longitude: number | null },
): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId,
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: locationId,
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
    vehicleId: `veh_${locationId}`,
    name: 'Toyota Yaris',
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
  }
}

describe('PigeonMapAdapter', () => {
  it('renders one marker per geocoded location at its coordinates', () => {
    render(
      <PigeonMapAdapter
        items={[
          carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
          carAt('loc_umeda', { latitude: 34.7025, longitude: 135.4959 }),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    )

    const markers = screen.getAllByTestId('marker')
    expect(markers).toHaveLength(2)
    expect(markers[0]).toHaveAttribute('data-anchor', '34.6627,135.5023')
    expect(markers[1]).toHaveAttribute('data-anchor', '34.7025,135.4959')
  })

  it('skips a row whose coordinates are null (defensive — never plots a bad anchor)', () => {
    render(
      <PigeonMapAdapter
        items={[
          carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
          carAt('loc_nowhere', { latitude: null, longitude: null }),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    )

    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })

  it('calls onSelect with the clicked location id', () => {
    const onSelect = vi.fn()
    render(
      <PigeonMapAdapter
        items={[carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 })]}
        selectedId={null}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByTestId('marker'))

    expect(onSelect).toHaveBeenCalledWith('loc_namba')
  })

  it('marks the selected location with a distinct marker color', () => {
    render(
      <PigeonMapAdapter
        items={[
          carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
          carAt('loc_umeda', { latitude: 34.7025, longitude: 135.4959 }),
        ]}
        selectedId="loc_umeda"
        onSelect={() => {}}
      />,
    )

    const markers = screen.getAllByTestId('marker')
    expect(markers[0]?.getAttribute('data-color')).not.toBe(markers[1]?.getAttribute('data-color'))
  })

  it('configures an explicit GSI tile provider, not the default public OSM server (#660)', () => {
    render(
      <PigeonMapAdapter
        items={[carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    )

    const tileUrl = screen.getByTestId('pigeon-map').getAttribute('data-tile-url') ?? ''
    expect(tileUrl).toContain('cyberjapandata.gsi.go.jp')
    expect(tileUrl).not.toContain('tile.openstreetmap.org')
  })

  it('renders a visible basemap attribution crediting the tile source (#660)', () => {
    render(
      <PigeonMapAdapter
        items={[carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    )

    const credit = screen.getByRole('link', { name: '国土地理院' })
    expect(credit.getAttribute('href')).toContain('gsi.go.jp')
  })

  it('centers on the region anchor at the region zoom when one is given (#840)', () => {
    render(
      <PigeonMapAdapter
        // Pin sits away from the anchor: the anchor must win over the pin-derived fit.
        items={[carAt('loc_namba', { latitude: 34.7025, longitude: 135.4959 })]}
        selectedId={null}
        onSelect={() => {}}
        anchor={[34.6655, 135.5023]}
      />,
    )

    const map = screen.getByTestId('pigeon-map')
    expect(map).toHaveAttribute('data-center', '34.6655,135.5023')
    expect(map).toHaveAttribute('data-zoom', '11')
  })

  it('fits the pins (centers a lone pin on itself) when no anchor is given (#840 fallback)', () => {
    render(
      <PigeonMapAdapter
        items={[carAt('loc_namba', { latitude: 34.66, longitude: 135.5 })]}
        selectedId={null}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByTestId('pigeon-map')).toHaveAttribute('data-center', '34.66,135.5')
  })

  it('recenters on the selected pin (fly-to) when one is selected', () => {
    render(
      <PigeonMapAdapter
        items={[
          carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
          carAt('loc_umeda', { latitude: 34.7025, longitude: 135.4959 }),
        ]}
        selectedId="loc_umeda"
        onSelect={() => {}}
      />,
    )
    const map = screen.getByTestId('pigeon-map')
    expect(map).toHaveAttribute('data-center', '34.7025,135.4959')
    expect(map).toHaveAttribute('data-zoom', '12') // SINGLE_PIN_ZOOM
  })

  it('renders the selected popup at its pin via renderSelected, and nothing when unselected', () => {
    const renderSelected = (item: SpecificSearchResult) => (
      <div data-testid="popup">{item.location.locationId}</div>
    )
    const props = {
      items: [carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 })],
      onSelect: () => {},
      renderSelected,
    }
    const { rerender } = render(<PigeonMapAdapter {...props} selectedId={null} />)
    expect(screen.queryByTestId('popup')).toBeNull()

    rerender(<PigeonMapAdapter {...props} selectedId="loc_namba" />)
    const overlay = screen.getByTestId('overlay')
    expect(overlay).toHaveAttribute('data-anchor', '34.6627,135.5023')
    expect(screen.getByTestId('popup')).toHaveTextContent('loc_namba')
  })

  it('flies to a newly selected pin without remounting the map (no tile-thrash)', () => {
    const props = {
      items: [
        carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
        carAt('loc_umeda', { latitude: 34.7025, longitude: 135.4959 }),
      ],
      onSelect: () => {},
    }
    const { rerender } = render(<PigeonMapAdapter {...props} selectedId={null} />)
    const before = screen.getByTestId('pigeon-map')

    rerender(<PigeonMapAdapter {...props} selectedId="loc_umeda" />)
    const after = screen.getByTestId('pigeon-map')

    // Same DOM node across the selection = React never remounted <Map>. The old
    // remount-key impl replaced the node, re-fetching every tile on each select.
    expect(after).toBe(before)
    // ...and it still flew to the selected pin (controlled center/zoom).
    expect(after).toHaveAttribute('data-center', '34.7025,135.4959')
    expect(after).toHaveAttribute('data-zoom', '12') // SINGLE_PIN_ZOOM
  })

  it('folds a manual pan into state, then recenters on a new region without remounting (no drift)', () => {
    const { rerender } = render(
      <PigeonMapAdapter
        items={[carAt('loc_a', { latitude: 34.7025, longitude: 135.4959 })]}
        selectedId={null}
        onSelect={() => {}}
        anchor={[34.6655, 135.5023]}
      />,
    )
    const node = screen.getByTestId('pigeon-map')
    expect(node).toHaveAttribute('data-center', '34.6655,135.5023') // region A

    fireEvent.click(screen.getByTestId('pan-map')) // user pans away
    expect(node).toHaveAttribute('data-center', '10,10') // pan synced into controlled state

    rerender(
      <PigeonMapAdapter
        items={[carAt('loc_b', { latitude: 35.0, longitude: 135.8 })]}
        selectedId={null}
        onSelect={() => {}}
        anchor={[34.9, 135.9]}
      />,
    )
    const after = screen.getByTestId('pigeon-map')
    expect(after).toBe(node) // still no remount
    expect(after).toHaveAttribute('data-center', '34.9,135.9') // reset to region B, pan discarded
    expect(after).toHaveAttribute('data-zoom', '11') // REGION_ZOOM
  })

  it('keeps the map on a still-present selection when the result set changes', () => {
    const loc1 = carAt('loc_1', { latitude: 34.5, longitude: 135.4 })
    const { rerender } = render(
      <PigeonMapAdapter items={[loc1]} selectedId="loc_1" onSelect={() => {}} />,
    )
    expect(screen.getByTestId('pigeon-map')).toHaveAttribute('data-center', '34.5,135.4')

    // New result set still contains loc_1, plus a region anchor that must NOT win.
    rerender(
      <PigeonMapAdapter
        items={[loc1, carAt('loc_2', { latitude: 35.0, longitude: 135.8 })]}
        selectedId="loc_1"
        onSelect={() => {}}
        anchor={[34.9, 135.9]}
      />,
    )
    const map = screen.getByTestId('pigeon-map')
    expect(map).toHaveAttribute('data-center', '34.5,135.4') // selection beats the new anchor
    expect(map).toHaveAttribute('data-zoom', '12') // SINGLE_PIN_ZOOM
  })

  it('falls through to the new region when the selection vanishes from the result set', () => {
    const { rerender } = render(
      <PigeonMapAdapter
        items={[carAt('loc_1', { latitude: 34.5, longitude: 135.4 })]}
        selectedId="loc_1"
        onSelect={() => {}}
      />,
    )
    // loc_1 is gone from the next set; the stale selection must not pin the viewport.
    rerender(
      <PigeonMapAdapter
        items={[carAt('loc_2', { latitude: 35.0, longitude: 135.8 })]}
        selectedId="loc_1"
        onSelect={() => {}}
        anchor={[34.9, 135.9]}
      />,
    )
    const map = screen.getByTestId('pigeon-map')
    expect(map).toHaveAttribute('data-center', '34.9,135.9') // stale selection → region B
    expect(map).toHaveAttribute('data-zoom', '11') // REGION_ZOOM
  })

  it('recenters when the same location id reports new coordinates (P2)', () => {
    const { rerender } = render(
      <PigeonMapAdapter
        items={[carAt('loc_1', { latitude: 34.5, longitude: 135.4 })]}
        selectedId="loc_1"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('pigeon-map')).toHaveAttribute('data-center', '34.5,135.4')

    // Same id, moved coords: the target signature must include lat:lng or this drifts.
    rerender(
      <PigeonMapAdapter
        items={[carAt('loc_1', { latitude: 35.1, longitude: 135.9 })]}
        selectedId="loc_1"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('pigeon-map')).toHaveAttribute('data-center', '35.1,135.9')
  })
})

describe('gsiTileProvider', () => {
  it('builds the GSI std raster tile URL in {z}/{x}/{y} order', () => {
    expect(gsiTileProvider(3, 5, 12)).toBe('https://cyberjapandata.gsi.go.jp/xyz/std/12/3/5.png')
  })
})
