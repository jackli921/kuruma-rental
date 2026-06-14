import { describe, expect, it } from 'vitest'
import {
  REGION_SANITY_RADIUS_KM,
  haversineKm,
  nearestAssignableRegion,
  planRegionBackfill,
} from '../../src/lib/region-distance'

// Real Kansai coords (WGS84) mirrored from the demo locations so the tests read
// against credible geography rather than synthetic numbers.
const NAMBA = { latitude: 34.6627, longitude: 135.5012 }
const UMEDA = { latitude: 34.7025, longitude: 135.4959 }
const KIX = { latitude: 34.4347, longitude: 135.2441 }
const TOKYO = { latitude: 35.6812, longitude: 139.7671 } // ~400 km from Kansai

const area = (over: Partial<Parameters<typeof nearestAssignableRegion>[0][number]> = {}) => ({
  id: 'reg_namba',
  latitude: NAMBA.latitude as number | null,
  longitude: NAMBA.longitude as number | null,
  assignable: true,
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  sortOrder: 0,
  ...over,
})

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(NAMBA, NAMBA)).toBe(0)
  })

  it('matches the known Namba↔Umeda great-circle distance (~4.4 km)', () => {
    expect(haversineKm(NAMBA, UMEDA)).toBeCloseTo(4.4, 0)
  })

  it('is symmetric', () => {
    expect(haversineKm(NAMBA, KIX)).toBeCloseTo(haversineKm(KIX, NAMBA), 6)
  })
})

describe('nearestAssignableRegion', () => {
  it('returns null when the point is null', () => {
    expect(nearestAssignableRegion([area()], null)).toBeNull()
  })

  it('returns null when there are no regions', () => {
    expect(nearestAssignableRegion([], NAMBA)).toBeNull()
  })

  it('picks the geographically nearest eligible region', () => {
    const regions = [
      area({ id: 'reg_kix', ...KIX }),
      area({ id: 'reg_umeda', ...UMEDA }),
      area({ id: 'reg_namba', ...NAMBA }),
    ]
    // A point sitting on Umeda must resolve to Umeda, not Namba/KIX.
    expect(nearestAssignableRegion(regions, UMEDA)?.id).toBe('reg_umeda')
  })

  it('ignores non-assignable regions even when closest', () => {
    const regions = [
      area({ id: 'reg_namba', ...NAMBA, assignable: false }),
      area({ id: 'reg_umeda', ...UMEDA, assignable: true }),
    ]
    expect(nearestAssignableRegion(regions, NAMBA)?.id).toBe('reg_umeda')
  })

  it('ignores INACTIVE regions even when closest', () => {
    const regions = [
      area({ id: 'reg_namba', ...NAMBA, status: 'INACTIVE' }),
      area({ id: 'reg_umeda', ...UMEDA, status: 'ACTIVE' }),
    ]
    expect(nearestAssignableRegion(regions, NAMBA)?.id).toBe('reg_umeda')
  })

  it('ignores regions without coordinates', () => {
    const regions = [
      area({ id: 'reg_namba', latitude: null, longitude: null }),
      area({ id: 'reg_umeda', ...UMEDA }),
    ]
    expect(nearestAssignableRegion(regions, NAMBA)?.id).toBe('reg_umeda')
  })

  it('returns null when the nearest region is beyond the sanity radius', () => {
    expect(nearestAssignableRegion([area({ id: 'reg_namba', ...NAMBA })], TOKYO)).toBeNull()
  })

  it('skips an out-of-radius region but still selects a nearer one later in the list', () => {
    // Far region listed FIRST: a `continue`->`break` mutation in the radius guard
    // would exit before reaching the in-radius region and wrongly return null.
    const regions = [
      area({ id: 'reg_tokyo', ...TOKYO }), // ~400 km from NAMBA — beyond radius
      area({ id: 'reg_umeda', ...UMEDA }), // ~4 km from NAMBA — within radius
    ]
    expect(nearestAssignableRegion(regions, NAMBA)?.id).toBe('reg_umeda')
  })

  it('accepts a region just inside the radius and rejects one just outside it', () => {
    // On the equator east of (0,0), distance ≈ 6371 km · Δlng(rad). 0.898° ≈ 99.85 km
    // (inside 100 km); 0.902° ≈ 100.30 km (outside). Straddles REGION_SANITY_RADIUS_KM,
    // pinning the radius constant + the cutoff direction without a flaky exact-boundary point.
    const origin = { latitude: 0, longitude: 0 }
    const justInside = area({ id: 'reg_inside', latitude: 0, longitude: 0.898 })
    const justOutside = area({ id: 'reg_outside', latitude: 0, longitude: 0.902 })
    expect(nearestAssignableRegion([justInside], origin)?.id).toBe('reg_inside')
    expect(nearestAssignableRegion([justOutside], origin)).toBeNull()
  })

  it('breaks ties by sortOrder, then id, when distances are equal', () => {
    const regions = [
      area({ id: 'reg_b', ...NAMBA, sortOrder: 2 }),
      area({ id: 'reg_a', ...NAMBA, sortOrder: 1 }),
      area({ id: 'reg_c', ...NAMBA, sortOrder: 1 }),
    ]
    // Equal distance (same coords): lowest sortOrder wins; sortOrder tie → lowest id.
    expect(nearestAssignableRegion(regions, NAMBA)?.id).toBe('reg_a')
  })

  it('keeps the sanity radius within a sane Kansai-scale bound', () => {
    expect(REGION_SANITY_RADIUS_KM).toBeGreaterThan(0)
    expect(REGION_SANITY_RADIUS_KM).toBeLessThanOrEqual(150)
  })
})

describe('planRegionBackfill', () => {
  const areas = [
    area({ id: 'reg_namba', ...NAMBA }),
    area({ id: 'reg_umeda', ...UMEDA }),
    area({ id: 'reg_kix', ...KIX }),
  ]

  it('assigns a coord-bearing ACTIVE location with no region to its nearest area', () => {
    const plan = planRegionBackfill(areas, [
      { id: 'loc_1', ...UMEDA, regionId: null, status: 'ACTIVE' },
    ])
    expect(plan.assignments).toEqual([{ locationId: 'loc_1', regionId: 'reg_umeda' }])
    expect(plan.unassigned).toEqual([])
  })

  it('reports far-away locations as unassigned instead of mis-assigning them', () => {
    const plan = planRegionBackfill(areas, [
      { id: 'loc_tokyo', ...TOKYO, regionId: null, status: 'ACTIVE' },
    ])
    expect(plan.assignments).toEqual([])
    expect(plan.unassigned).toEqual(['loc_tokyo'])
  })

  it('is idempotent: leaves already-assigned locations untouched', () => {
    const plan = planRegionBackfill(areas, [
      { id: 'loc_1', ...UMEDA, regionId: 'reg_umeda', status: 'ACTIVE' },
    ])
    expect(plan.assignments).toEqual([])
    expect(plan.unassigned).toEqual([])
  })

  it('skips locations with no coordinates', () => {
    const plan = planRegionBackfill(areas, [
      { id: 'loc_nogeo', latitude: null, longitude: null, regionId: null, status: 'ACTIVE' },
    ])
    expect(plan.assignments).toEqual([])
    expect(plan.unassigned).toEqual([])
  })

  it('skips ARCHIVED locations', () => {
    const plan = planRegionBackfill(areas, [
      { id: 'loc_archived', ...UMEDA, regionId: null, status: 'ARCHIVED' },
    ])
    expect(plan.assignments).toEqual([])
    expect(plan.unassigned).toEqual([])
  })

  it('handles a mixed batch in one pass: assigns the eligible, buckets the far, skips the rest', () => {
    // >1 location exercises loop accumulation + ordering that a single-location
    // case can't: an early-skip (already-assigned) must not drop a later
    // assignment, and assignments preserve input order alongside the unassigned bucket.
    const plan = planRegionBackfill(areas, [
      { id: 'loc_umeda', ...UMEDA, regionId: null, status: 'ACTIVE' }, // -> reg_umeda
      { id: 'loc_done', ...NAMBA, regionId: 'reg_namba', status: 'ACTIVE' }, // already assigned -> skip
      { id: 'loc_kix', ...KIX, regionId: null, status: 'ACTIVE' }, // -> reg_kix
      { id: 'loc_tokyo', ...TOKYO, regionId: null, status: 'ACTIVE' }, // far -> unassigned
      { id: 'loc_arch', ...UMEDA, regionId: null, status: 'ARCHIVED' }, // archived -> skip
      { id: 'loc_nogeo', latitude: null, longitude: null, regionId: null, status: 'ACTIVE' }, // no coords -> skip
    ])
    expect(plan.assignments).toEqual([
      { locationId: 'loc_umeda', regionId: 'reg_umeda' },
      { locationId: 'loc_kix', regionId: 'reg_kix' },
    ])
    expect(plan.unassigned).toEqual(['loc_tokyo'])
  })
})
