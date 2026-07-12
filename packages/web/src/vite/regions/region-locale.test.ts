import type { RegionNode } from '@kuruma/shared/types/region'
import { describe, expect, it } from 'vitest'
import { orderRegionsForLocale, regionMatchesQuery, regionName } from './region-locale'

function makeRegion(overrides: Pick<RegionNode, 'id'> & Partial<RegionNode>): RegionNode {
  return {
    parentId: null,
    slug: null,
    nameEn: 'Region',
    nameJa: '地域',
    nameZh: '地区',
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: true,
    status: 'ACTIVE',
    sortOrder: 0,
    ...overrides,
  }
}

// sortOrder ascending mirrors the API order (ORDER BY sortOrder, nameEn). The English
// names are deliberately NOT alphabetical in this input so an en-sort is observable.
const OSAKA = makeRegion({
  id: 'osaka',
  nameEn: 'Osaka',
  nameJa: '大阪',
  nameZh: '大阪',
  sortOrder: 0,
})
const AICHI = makeRegion({
  id: 'aichi',
  nameEn: 'Aichi',
  nameJa: '愛知',
  nameZh: '爱知',
  sortOrder: 1,
})
const KYOTO = makeRegion({
  id: 'kyoto',
  nameEn: 'Kyōto',
  nameJa: '京都',
  nameZh: '京都',
  sortOrder: 2,
})
const INPUT = [OSAKA, AICHI, KYOTO] as const

describe('regionName', () => {
  it('returns the name for the active locale', () => {
    expect(regionName(OSAKA, 'en')).toBe('Osaka')
    expect(regionName(OSAKA, 'ja')).toBe('大阪')
    expect(regionName(OSAKA, 'zh')).toBe('大阪')
  })

  it('falls back to the English name when the localized name is empty', () => {
    const blankJa = makeRegion({ id: 'x', nameEn: 'Sakai', nameJa: '', nameZh: '' })
    expect(regionName(blankJa, 'ja')).toBe('Sakai')
    expect(regionName(blankJa, 'zh')).toBe('Sakai')
  })
})

describe('orderRegionsForLocale', () => {
  it('sorts English A-Z by the English name', () => {
    expect(orderRegionsForLocale(INPUT, 'en').map((r) => r.id)).toEqual(['aichi', 'kyoto', 'osaka'])
  })

  it('preserves the API sortOrder for Japanese and Chinese', () => {
    expect(orderRegionsForLocale(INPUT, 'ja').map((r) => r.id)).toEqual(['osaka', 'aichi', 'kyoto'])
    expect(orderRegionsForLocale(INPUT, 'zh').map((r) => r.id)).toEqual(['osaka', 'aichi', 'kyoto'])
  })

  it('does not mutate the input array', () => {
    const copy = [...INPUT]
    orderRegionsForLocale(INPUT, 'en')
    expect(INPUT).toEqual(copy)
  })
})

describe('regionMatchesQuery', () => {
  it('matches everything on an empty query', () => {
    expect(regionMatchesQuery(OSAKA, '', 'ja')).toBe(true)
    expect(regionMatchesQuery(OSAKA, '   ', 'ja')).toBe(true)
  })

  it('matches the active-locale name case-insensitively', () => {
    expect(regionMatchesQuery(OSAKA, 'OSA', 'en')).toBe(true)
    expect(regionMatchesQuery(OSAKA, '大阪', 'ja')).toBe(true)
  })

  it('matches a Japanese-labelled entry via its romanized English name', () => {
    // A Japanese visitor sees 大阪, but an English typer should still find it by "osaka".
    expect(regionMatchesQuery(OSAKA, 'osaka', 'ja')).toBe(true)
  })

  it('is accent-insensitive both ways', () => {
    expect(regionMatchesQuery(KYOTO, 'kyoto', 'en')).toBe(true) // query plain, name "Kyōto"
    expect(regionMatchesQuery(KYOTO, 'kyōto', 'ja')).toBe(true) // query accented
  })

  it('returns false when nothing matches', () => {
    expect(regionMatchesQuery(OSAKA, 'zzz', 'en')).toBe(false)
  })
})
