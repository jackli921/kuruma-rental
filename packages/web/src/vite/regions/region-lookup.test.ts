import type { RegionNode } from '@kuruma/shared/types/region'
import { describe, expect, test } from 'vitest'
import { resolveSlugToRegionId } from './region-lookup'

// A full RegionNode is wide (geo + tree + trilingual-name fields); this factory
// keeps each case to the only fields under test (id, slug).
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
