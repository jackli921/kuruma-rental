import type { RegionNode } from '@kuruma/shared/types/region'
import { describe, expect, test } from 'vitest'
import {
  findRegionBySlug,
  regionChain,
  resolveRegionAnchor,
  resolveSlugToRegionId,
} from './region-lookup'

// A full RegionNode is wide (geo + tree + trilingual-name fields); this factory
// keeps each case to the only fields under test (id, slug, type, parentId).
function makeRegion(overrides: Pick<RegionNode, 'id' | 'slug'> & Partial<RegionNode>): RegionNode {
  return {
    parentId: null,
    nameEn: 'Region',
    nameJa: '地域',
    nameZh: '地区',
    type: 'AREA',
    latitude: null,
    longitude: null,
    assignable: true,
    status: 'ACTIVE',
    sortOrder: 0,
    ...overrides,
  }
}

const regions: RegionNode[] = [
  makeRegion({ id: 'reg_osaka', slug: 'osaka', type: 'PREFECTURE' }),
  makeRegion({ id: 'reg_namba', slug: 'namba', type: 'AREA' }),
]

// A real prefecture -> city -> area chain for the navigation helpers.
const tree: RegionNode[] = [
  makeRegion({ id: 'reg_osaka', slug: 'osaka', type: 'PREFECTURE', parentId: null }),
  makeRegion({ id: 'reg_osaka_city', slug: 'osaka-city', type: 'CITY', parentId: 'reg_osaka' }),
  makeRegion({ id: 'reg_namba', slug: 'namba', type: 'AREA', parentId: 'reg_osaka_city' }),
]

describe('resolveSlugToRegionId', () => {
  test('returns the region id for a known slug', () => {
    expect(resolveSlugToRegionId(regions, 'namba')).toBe('reg_namba')
  })

  test('returns undefined for an unknown slug', () => {
    expect(resolveSlugToRegionId(regions, 'kyoto')).toBeUndefined()
  })

  test('never matches a node whose slug is null', () => {
    const onlyNull: RegionNode[] = [makeRegion({ id: 'reg_unslugged', slug: null })]
    expect(resolveSlugToRegionId(onlyNull, 'anything')).toBeUndefined()
  })
})

describe('findRegionBySlug', () => {
  test('returns the matching node for a known slug', () => {
    expect(findRegionBySlug(tree, 'osaka-city')?.id).toBe('reg_osaka_city')
  })

  test('returns undefined for an unknown slug', () => {
    expect(findRegionBySlug(tree, 'nope')).toBeUndefined()
  })
})

describe('resolveRegionAnchor', () => {
  const located: RegionNode[] = [
    makeRegion({ id: 'reg_namba', slug: 'namba', latitude: 34.6655, longitude: 135.5023 }),
    makeRegion({ id: 'reg_unlocated', slug: 'unlocated', latitude: null, longitude: null }),
  ]

  test("returns the region's center as a GeoPoint for a known, located slug", () => {
    expect(resolveRegionAnchor(located, 'namba')).toEqual({
      latitude: 34.6655,
      longitude: 135.5023,
    })
  })

  test('returns null when the region exists but has no coordinates', () => {
    expect(resolveRegionAnchor(located, 'unlocated')).toBeNull()
  })

  test('returns null for an unknown slug', () => {
    expect(resolveRegionAnchor(located, 'kyoto')).toBeNull()
  })

  test('returns null when no slug is chosen (no anchor)', () => {
    expect(resolveRegionAnchor(located, undefined)).toBeNull()
  })

  test('returns null before the region list has loaded', () => {
    expect(resolveRegionAnchor(undefined, 'namba')).toBeNull()
  })
})

describe('regionChain', () => {
  test('walks an area id up to its city and prefecture', () => {
    const chain = regionChain(tree, 'reg_namba')
    expect(chain.prefecture?.id).toBe('reg_osaka')
    expect(chain.city?.id).toBe('reg_osaka_city')
    expect(chain.area?.id).toBe('reg_namba')
  })

  test('a city id fills prefecture + city, leaves area null', () => {
    const chain = regionChain(tree, 'reg_osaka_city')
    expect(chain.prefecture?.id).toBe('reg_osaka')
    expect(chain.city?.id).toBe('reg_osaka_city')
    expect(chain.area).toBeNull()
  })

  test('a prefecture id fills only prefecture', () => {
    const chain = regionChain(tree, 'reg_osaka')
    expect(chain.prefecture?.id).toBe('reg_osaka')
    expect(chain.city).toBeNull()
    expect(chain.area).toBeNull()
  })

  test('null id yields an empty chain', () => {
    expect(regionChain(tree, null)).toEqual({ prefecture: null, city: null, area: null })
  })

  test('unknown id yields an empty chain', () => {
    expect(regionChain(tree, 'ghost')).toEqual({ prefecture: null, city: null, area: null })
  })

  // The region taxonomy is a self-FK with no DB-level cycle constraint and feeds
  // this walk on every render over the public region list — a malformed row must
  // terminate the walk, not hang the renter's tab.
  test('terminates on a self-referential parent', () => {
    const selfCycle: RegionNode[] = [
      makeRegion({ id: 'reg_loop', slug: 'loop', type: 'PREFECTURE', parentId: 'reg_loop' }),
    ]
    const chain = regionChain(selfCycle, 'reg_loop')
    expect(chain.prefecture?.id).toBe('reg_loop')
    expect(chain.city).toBeNull()
    expect(chain.area).toBeNull()
  })

  test('terminates on a parent cycle (A -> B -> A)', () => {
    const cycle: RegionNode[] = [
      makeRegion({ id: 'reg_a', slug: 'a', type: 'CITY', parentId: 'reg_b' }),
      makeRegion({ id: 'reg_b', slug: 'b', type: 'PREFECTURE', parentId: 'reg_a' }),
    ]
    const chain = regionChain(cycle, 'reg_a')
    // Visits A (city) then B (prefecture), then stops before revisiting A.
    expect(chain.city?.id).toBe('reg_a')
    expect(chain.prefecture?.id).toBe('reg_b')
    expect(chain.area).toBeNull()
  })
})
