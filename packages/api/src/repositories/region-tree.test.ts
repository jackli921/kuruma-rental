import { describe, expect, it } from 'vitest'
import type { Region } from '../stores'
import { collectDescendantIds } from './region-tree'

const region = (id: string, parentId: string | null): Region => ({
  id,
  parentId,
  nameEn: id,
  nameJa: id,
  nameZh: id,
  sortOrder: 0,
  // #651 2b: geo/taxonomy fields are unused by these tree-walk fixtures → defaults.
  type: null,
  latitude: null,
  longitude: null,
  assignable: false,
  status: 'ACTIVE',
  slug: null,
})

describe('collectDescendantIds (#394 region tree walk)', () => {
  it('returns the node + its whole subtree, inclusive', () => {
    const tree = [
      region('osaka', null),
      region('osaka_city', 'osaka'),
      region('namba', 'osaka_city'),
      region('kyoto', null),
    ]
    expect(new Set(collectDescendantIds(tree, 'osaka'))).toEqual(
      new Set(['osaka', 'osaka_city', 'namba']),
    )
  })

  it('returns [] for an unknown root id', () => {
    expect(collectDescendantIds([region('osaka', null)], 'ghost')).toEqual([])
  })

  // The regions.parentId self-FK has no DB cycle constraint, so a malformed row is
  // storable. Pre-fix these inputs spun forever on a public endpoint (CPU-limit DoS).
  it('terminates on a 2-node cycle and yields each id exactly once', () => {
    const cyclic = [region('a', 'b'), region('b', 'a')]
    const result = collectDescendantIds(cyclic, 'a')
    expect(result.length).toBe(new Set(result).size) // no duplicates
    expect(new Set(result)).toEqual(new Set(['a', 'b']))
  })

  it('terminates on a self-parent row', () => {
    expect(collectDescendantIds([region('a', 'a')], 'a')).toEqual(['a'])
  })

  it('terminates on a longer cycle (a->b->c->a) with each id once', () => {
    const cyclic = [region('a', 'c'), region('b', 'a'), region('c', 'b')]
    const result = collectDescendantIds(cyclic, 'a')
    expect(result.length).toBe(new Set(result).size)
    expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']))
  })
})
