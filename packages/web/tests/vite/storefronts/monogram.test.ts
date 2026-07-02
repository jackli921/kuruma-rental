import { storeInitials } from '@/vite/storefronts/monogram'
import { describe, expect, it } from 'vitest'

describe('storeInitials', () => {
  it('takes the first letter of the first two words for a multi-word name', () => {
    expect(storeInitials('Best Car Rental Osaka')).toBe('BC')
  })

  it('takes both leading initials for a two-word name', () => {
    expect(storeInitials('Sakura Rentals')).toBe('SR')
  })

  it('uses the first two characters of a single-word name', () => {
    expect(storeInitials('Toyota')).toBe('TO')
  })

  it('collapses surrounding and interior whitespace', () => {
    expect(storeInitials('  Best   Car  ')).toBe('BC')
  })

  it('uppercases lowercased latin names', () => {
    expect(storeInitials('toyota rent')).toBe('TR')
  })

  it('uses the first two characters for a space-less CJK name', () => {
    expect(storeInitials('大阪レンタカー')).toBe('大阪')
  })

  it('returns an empty string for a blank name', () => {
    expect(storeInitials('   ')).toBe('')
  })
})
