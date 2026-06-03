import { describe, expect, it } from 'vitest'
import { ACRISS_CODES, ACRISS_PATTERN } from '../src/acriss'

describe('ACRISS_PATTERN', () => {
  it('accepts a four-character upper-case code', () => {
    expect(ACRISS_PATTERN.test('CCAR')).toBe(true)
  })

  it('accepts the digit 9 (ACRISS "or higher" axis marker)', () => {
    expect(ACRISS_PATTERN.test('SUV9')).toBe(true)
  })

  it('rejects a three-character code', () => {
    expect(ACRISS_PATTERN.test('CCA')).toBe(false)
  })

  it('rejects a five-character code', () => {
    expect(ACRISS_PATTERN.test('CCARX')).toBe(false)
  })

  it('rejects lowercase', () => {
    expect(ACRISS_PATTERN.test('ccar')).toBe(false)
  })

  it('rejects non-alphanumeric characters', () => {
    expect(ACRISS_PATTERN.test('CC-R')).toBe(false)
  })

  it('is anchored — rejects a valid code embedded in a longer string', () => {
    expect(ACRISS_PATTERN.test('XCCARX')).toBe(false)
  })
})

describe('ACRISS_CODES', () => {
  it('is the 8-code MVP subset', () => {
    expect(Object.keys(ACRISS_CODES)).toEqual([
      'MCAR',
      'ECAR',
      'CCAR',
      'ICAR',
      'SCAR',
      'FCAR',
      'IVAR',
      'SUVR',
    ])
  })

  it('maps each code to its i18n key', () => {
    expect(ACRISS_CODES.CCAR).toBe('acriss.CCAR')
    expect(ACRISS_CODES.SUVR).toBe('acriss.SUVR')
  })

  it('every dictionary key is itself a format-valid ACRISS code', () => {
    for (const code of Object.keys(ACRISS_CODES)) {
      expect(ACRISS_PATTERN.test(code)).toBe(true)
    }
  })
})
