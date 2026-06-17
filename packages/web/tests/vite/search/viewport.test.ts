import {
  type Pin,
  REGION_ZOOM,
  SINGLE_PIN_ZOOM,
  computeViewport,
  focusViewport,
} from '@/vite/search/viewport'
import { describe, expect, it } from 'vitest'

const pin = (id: string, lat: number, lng: number): Pin => ({ id, lat, lng })

// Seeded Kansai storefront coords (Osaka / Kyoto / Nara / KIX) — the spread that
// made a first-pin-only viewport hide most markers.
const OSAKA = pin('osaka', 34.6627, 135.5023)
const KYOTO = pin('kyoto', 35.0116, 135.7681)
const NARA = pin('nara', 34.6851, 135.8048)
const KIX = pin('kix', 34.4347, 135.244)

describe('computeViewport', () => {
  it('centers a single pin on itself at the single-pin zoom', () => {
    const vp = computeViewport([OSAKA])
    expect(vp.center).toEqual([34.6627, 135.5023])
    expect(vp.zoom).toBe(SINGLE_PIN_ZOOM)
  })

  it('centers a spread on the bounding-box midpoint, not the first pin', () => {
    const vp = computeViewport([OSAKA, KYOTO, NARA, KIX])
    const midLat = (34.4347 + 35.0116) / 2
    const midLng = (135.244 + 135.8048) / 2
    expect(vp.center[0]).toBeCloseTo(midLat, 6)
    expect(vp.center[1]).toBeCloseTo(midLng, 6)
    // Must NOT just sit on the first pin (Osaka) — that was the bug.
    expect(vp.center[0]).not.toBeCloseTo(OSAKA.lat, 4)
  })

  it('zooms out for a wider spread so every pin fits', () => {
    const kansai = computeViewport([OSAKA, KYOTO, NARA, KIX]).zoom
    const tight = computeViewport([OSAKA, pin('namba', 34.6657, 135.5031)]).zoom
    expect(kansai).toBeLessThan(tight)
    expect(kansai).toBeLessThan(SINGLE_PIN_ZOOM)
  })

  it('never increases zoom as the span grows (monotonic)', () => {
    const spans = [0.0, 0.05, 0.2, 0.6, 1.5].map(
      (d) => computeViewport([pin('a', 34, 135), pin('b', 34 + d, 135 + d)]).zoom,
    )
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!).toBeLessThanOrEqual(spans[i - 1]!)
    }
  })
})

// #840 Slice B: a chosen region centers the map on its coords; a null anchor keeps
// the existing fit-all-pins behavior. The anchor [lat, lng] is the region center.
describe('computeViewport with a region anchor (#840)', () => {
  const NAMBA_CENTER: [number, number] = [34.6655, 135.5023]

  it('centers on the anchor at the region zoom, ignoring the pin bounding box', () => {
    const vp = computeViewport([OSAKA, KYOTO, NARA, KIX], NAMBA_CENTER)
    expect(vp.center).toEqual(NAMBA_CENTER)
    expect(vp.zoom).toBe(REGION_ZOOM)
    // The fit-all midpoint would land between Osaka and Kyoto — prove we overrode it.
    expect(vp.center).not.toEqual(computeViewport([OSAKA, KYOTO, NARA, KIX]).center)
  })

  it('centers on the anchor even when no pin is geocoded (region chosen, empty map)', () => {
    const vp = computeViewport([], NAMBA_CENTER)
    expect(vp.center).toEqual(NAMBA_CENTER)
    expect(vp.zoom).toBe(REGION_ZOOM)
  })

  it('falls back to fitting all pins when the anchor is null', () => {
    expect(computeViewport([OSAKA, KYOTO], null)).toEqual(computeViewport([OSAKA, KYOTO]))
  })

  it('frames a region broader than a single store (region zoom < single-pin zoom)', () => {
    expect(REGION_ZOOM).toBeLessThan(SINGLE_PIN_ZOOM)
  })
})

describe('focusViewport', () => {
  const pins = [
    { id: 'loc_namba', lat: 34.6627, lng: 135.5023 },
    { id: 'loc_umeda', lat: 34.7025, lng: 135.4959 },
  ]

  it('centers on the selected pin at the single-pin zoom', () => {
    expect(focusViewport(pins, null, 'loc_umeda')).toEqual({
      center: [34.7025, 135.4959],
      zoom: SINGLE_PIN_ZOOM,
    })
  })

  it('overrides the region anchor when a pin is selected (the selection wins)', () => {
    expect(focusViewport(pins, [34.99, 135.99], 'loc_namba').center).toEqual([34.6627, 135.5023])
  })

  it('falls back to computeViewport when nothing is selected', () => {
    expect(focusViewport(pins, null, null)).toEqual(computeViewport(pins, null))
  })

  it('falls back to computeViewport when the selected id matches no pin', () => {
    expect(focusViewport(pins, null, 'loc_ghost')).toEqual(computeViewport(pins, null))
  })
})
