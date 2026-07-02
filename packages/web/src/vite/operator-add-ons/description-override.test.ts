import { describe, expect, it } from 'vitest'
import { setLocaleSlot } from './description-override'

// The operator edits ONE locale slot (their UI language) at a time. Setting a slot
// must merge into the raw authored bag, never clobber the other locales the
// operator (or a translator) authored — and an emptied slot drops that locale,
// collapsing to null when nothing is left.
describe('setLocaleSlot', () => {
  it('sets a slot on an empty bag', () => {
    expect(setLocaleSlot(null, 'en', 'Rear-facing seat')).toEqual({ en: 'Rear-facing seat' })
  })

  it('merges without clobbering sibling locales', () => {
    expect(setLocaleSlot({ ja: 'ベビーシート' }, 'en', 'Child seat')).toEqual({
      ja: 'ベビーシート',
      en: 'Child seat',
    })
  })

  it('overwrites the same locale slot', () => {
    expect(setLocaleSlot({ en: 'old', ja: 'そのまま' }, 'en', 'new')).toEqual({
      en: 'new',
      ja: 'そのまま',
    })
  })

  it('trims whitespace before storing', () => {
    expect(setLocaleSlot(null, 'en', '  spaced  ')).toEqual({ en: 'spaced' })
  })

  it('drops the locale when cleared, keeping the rest', () => {
    expect(setLocaleSlot({ en: 'Child seat', ja: 'ベビーシート' }, 'en', '   ')).toEqual({
      ja: 'ベビーシート',
    })
  })

  it('returns null when clearing the last slot', () => {
    expect(setLocaleSlot({ en: 'Child seat' }, 'en', '')).toBeNull()
  })

  it('returns null when setting an empty slot on an empty bag', () => {
    expect(setLocaleSlot(null, 'ja', '')).toBeNull()
  })

  it('does not mutate the input bag (immutability)', () => {
    const input = { ja: 'ベビーシート' }
    setLocaleSlot(input, 'en', 'Child seat')
    expect(input).toEqual({ ja: 'ベビーシート' })
  })
})
