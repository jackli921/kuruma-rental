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
    defaultCenter,
    defaultZoom,
  }: {
    children: ReactNode
    provider?: (x: number, y: number, z: number) => string
    attribution?: ReactNode
    defaultCenter?: [number, number]
    defaultZoom?: number
  }) => (
    <div
      data-testid="pigeon-map"
      data-tile-url={provider ? provider(3, 5, 12) : ''}
      data-center={defaultCenter ? defaultCenter.join(',') : ''}
      data-zoom={defaultZoom ?? ''}
    >
      {attribution}
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
})

describe('gsiTileProvider', () => {
  it('builds the GSI std raster tile URL in {z}/{x}/{y} order', () => {
    expect(gsiTileProvider(3, 5, 12)).toBe('https://cyberjapandata.gsi.go.jp/xyz/std/12/3/5.png')
  })
})
