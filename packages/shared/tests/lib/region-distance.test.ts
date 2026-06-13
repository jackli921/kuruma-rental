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
})
