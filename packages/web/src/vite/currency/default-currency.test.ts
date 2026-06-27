import { describe, expect, it } from 'vitest'
import { defaultCurrencyForLocale } from './default-currency'

describe('defaultCurrencyForLocale', () => {
  it('infers USD for English-speaking tourists', () => {
    expect(defaultCurrencyForLocale('en')).toBe('USD')
  })

  it('infers CNY for the Chinese locale', () => {
    expect(defaultCurrencyForLocale('zh')).toBe('CNY')
  })

  it('keeps JPY for the Japanese locale so domestic renters see no conversion', () => {
    expect(defaultCurrencyForLocale('ja')).toBe('JPY')
  })

  it('defaults an unexpected locale to JPY — no conversion rather than a wrong one', () => {
    expect(defaultCurrencyForLocale('fr')).toBe('JPY')
  })
})
