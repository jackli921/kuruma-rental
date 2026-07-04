import { describe, expect, it } from 'vitest'
import { buildNameBundle } from './name-bundle'

// #1437: the self-authored name form has three slots (en/ja/zh); this collapses them
// into a LocalizedText bundle for the wire — en is the guaranteed floor, ja/zh are
// dropped when blank so the server never stores an empty locale.
describe('buildNameBundle', () => {
  it('keeps all three locales when every slot is filled', () => {
    expect(buildNameBundle('GPS unit', 'GPS ユニット', 'GPS 装置')).toEqual({
      en: 'GPS unit',
      ja: 'GPS ユニット',
      zh: 'GPS 装置',
    })
  })

  it('drops a blank ja/zh slot rather than storing an empty locale', () => {
    expect(buildNameBundle('GPS unit', '', '  ')).toEqual({ en: 'GPS unit' })
  })

  it('trims each slot', () => {
    expect(buildNameBundle('  GPS unit  ', '  GPS ユニット ', '')).toEqual({
      en: 'GPS unit',
      ja: 'GPS ユニット',
    })
  })
})
