import { describe, expect, it } from 'vitest'
import { buildNameBundle } from './name-bundle'

// #1437 slice 3: the self-authored insurance-name form has three slots (en/ja/zh);
// this collapses them into a LocalizedText bundle for the wire — en is the guaranteed
// floor, ja/zh are dropped when blank so the server never stores an empty locale.
describe('buildNameBundle', () => {
  it('keeps all three locales when every slot is filled', () => {
    expect(buildNameBundle('Full cover', 'フルカバー', '全保')).toEqual({
      en: 'Full cover',
      ja: 'フルカバー',
      zh: '全保',
    })
  })

  it('drops a blank ja/zh slot rather than storing an empty locale', () => {
    expect(buildNameBundle('Full cover', '', '  ')).toEqual({ en: 'Full cover' })
  })

  it('trims each slot', () => {
    expect(buildNameBundle('  Full cover  ', '  フルカバー ', '')).toEqual({
      en: 'Full cover',
      ja: 'フルカバー',
    })
  })
})
