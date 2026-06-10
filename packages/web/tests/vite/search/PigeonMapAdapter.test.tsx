import { PigeonMapAdapter } from '@/vite/search/PigeonMapAdapter'
import type { SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

// Mock pigeon-maps → no real tiles in happy-dom. Assert only the adapter's
// mapping of props → <Marker> components (the design's seam, not tile rendering).
vi.mock('pigeon-maps', () => ({
  Map: ({ children }: { children: ReactNode }) => <div data-testid="pigeon-map">{children}</div>,
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
})
