import { type Pin, SINGLE_PIN_ZOOM, computeViewport } from '@/vite/search/viewport'
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
