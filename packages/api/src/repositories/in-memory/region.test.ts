import { beforeEach, describe, expect, it } from 'vitest'
import type { Region } from '../../stores'
import { InMemoryRegionRepository } from './region'

// A small tree:  osaka -> {osaka_city -> {namba, umeda}, izumisano -> {kix}}
//                kyoto -> {kyoto_city}
const region = (id: string, parentId: string | null): Region => ({
  id,
  parentId,
  nameEn: id,
  nameJa: id,
  nameZh: id,
  sortOrder: 0,
})

const TREE: Region[] = [
  region('osaka', null),
  region('osaka_city', 'osaka'),
  region('namba', 'osaka_city'),
  region('umeda', 'osaka_city'),
  region('izumisano', 'osaka'),
  region('kix', 'izumisano'),
  region('kyoto', null),
  region('kyoto_city', 'kyoto'),
]

describe('InMemoryRegionRepository (#394)', () => {
  let repo: InMemoryRegionRepository

  beforeEach(() => {
    repo = new InMemoryRegionRepository(TREE)
  })

  it('findAll returns every region', async () => {
    const all = await repo.findAll()
    expect(all).toHaveLength(TREE.length)
    expect(new Set(all.map((r) => r.id))).toEqual(new Set(TREE.map((r) => r.id)))
  })

  it('findDescendantIds(prefecture) returns the whole subtree incl. self', async () => {
    const ids = await repo.findDescendantIds('osaka')
    expect(new Set(ids)).toEqual(
      new Set(['osaka', 'osaka_city', 'namba', 'umeda', 'izumisano', 'kix']),
    )
    // excludes the sibling prefecture's subtree
    expect(ids).not.toContain('kyoto')
    expect(ids).not.toContain('kyoto_city')
  })

  it('findDescendantIds(mid-level city) returns that node + its leaves only', async () => {
    const ids = await repo.findDescendantIds('osaka_city')
    expect(new Set(ids)).toEqual(new Set(['osaka_city', 'namba', 'umeda']))
    expect(ids).not.toContain('osaka')
    expect(ids).not.toContain('kix')
  })

  it('findDescendantIds(leaf) returns just that id', async () => {
    expect(await repo.findDescendantIds('namba')).toEqual(['namba'])
  })

  it('findDescendantIds(unknown id) returns empty (no match)', async () => {
    expect(await repo.findDescendantIds('does_not_exist')).toEqual([])
  })
})

// The DB self-FK on regions.parentId enforces referential integrity but CANNOT
// prevent a cycle (a -> b -> a). Bad/edited data reachable from a PUBLIC
// `?regionId=` search must not loop the Worker — the traversal needs a visited
// guard. Each test would hang forever on an unguarded BFS; they pass only once
// the walk records visited ids. (#394 review P1.)
describe('InMemoryRegionRepository cycle safety (#394 — parentId cycles)', () => {
  it('terminates and de-dupes on a direct 2-node cycle (a <-> b)', async () => {
    const repo = new InMemoryRegionRepository([region('a', 'b'), region('b', 'a')])
    const ids = await repo.findDescendantIds('a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b']))
    expect(ids).toHaveLength(2) // each id collected exactly once
  })

  it('terminates on a self-referential node (x -> x)', async () => {
    const repo = new InMemoryRegionRepository([region('x', 'x')])
    expect(await repo.findDescendantIds('x')).toEqual(['x'])
  })

  it('terminates on a 3-node cycle (a -> b -> c -> a) entered from any node', async () => {
    const repo = new InMemoryRegionRepository([
      region('a', 'c'),
      region('b', 'a'),
      region('c', 'b'),
    ])
    const ids = await repo.findDescendantIds('b')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
    expect(ids).toHaveLength(3)
  })

  it('still collects genuine descendants hanging off a cycle', async () => {
    // a <-> b cycle, plus a real leaf c under a. The guard must not drop c.
    const repo = new InMemoryRegionRepository([
      region('a', 'b'),
      region('b', 'a'),
      region('c', 'a'),
    ])
    const ids = await repo.findDescendantIds('a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
    expect(ids).toHaveLength(3)
  })
})
