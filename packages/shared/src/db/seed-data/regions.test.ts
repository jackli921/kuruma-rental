import { describe, expect, it } from 'vitest'
import { DEMO_REGIONS } from './regions'

// #1276 structural safety net. The seed relies on invariants a live DB would only
// catch at insert time (self-FK order, UNIQUE slug); this pins them in a unit test
// so a dataset typo (dup slug, mis-parented city, parent listed after its child)
// fails fast in CI instead of blowing up `db:seed`.
describe('DEMO_REGIONS structural invariants (#1276)', () => {
  const ids = new Set(DEMO_REGIONS.map((r) => r.id))

  it('holds exactly 47 PREFECTURE nodes', () => {
    expect(DEMO_REGIONS.filter((r) => r.type === 'PREFECTURE')).toHaveLength(47)
  })

  it('gives every node a unique, non-empty slug', () => {
    const slugs = DEMO_REGIONS.map((r) => r.slug)
    for (const slug of slugs) expect(slug.length).toBeGreaterThan(0)
    expect(new Set(slugs).size).toBe(DEMO_REGIONS.length)
  })

  it('gives every node a unique id', () => {
    expect(ids.size).toBe(DEMO_REGIONS.length)
  })

  it('resolves every non-null parentId to an id present in the array', () => {
    const dangling = DEMO_REGIONS.filter((r) => r.parentId !== null && !ids.has(r.parentId))
    expect(dangling.map((r) => r.id)).toEqual([])
  })

  it('lists every parent before its children (self-FK insert order)', () => {
    const firstIndexById = new Map(DEMO_REGIONS.map((r, i) => [r.id, i]))
    const outOfOrder = DEMO_REGIONS.filter(
      (r, i) =>
        r.parentId !== null && (firstIndexById.get(r.parentId) ?? Number.POSITIVE_INFINITY) >= i,
    )
    expect(outOfOrder.map((r) => r.id)).toEqual([])
  })

  it('gives every node non-empty trilingual names', () => {
    const missing = DEMO_REGIONS.filter(
      (r) => r.nameEn.length === 0 || r.nameJa.length === 0 || r.nameZh.length === 0,
    )
    expect(missing.map((r) => r.id)).toEqual([])
  })

  it('gives every prefecture at least one assignable CITY child', () => {
    const prefectures = DEMO_REGIONS.filter((r) => r.type === 'PREFECTURE')
    const barren = prefectures.filter(
      (pref) =>
        !DEMO_REGIONS.some((r) => r.type === 'CITY' && r.parentId === pref.id && r.assignable),
    )
    expect(barren.map((r) => r.id)).toEqual([])
  })
})
