import { describe, expect, it } from 'vitest'
import { ELIGIBILITY_CLASSES, classifyDrivingEligibility } from './driving-eligibility'

describe('ELIGIBILITY_CLASSES', () => {
  it('is the closed set of four classes', () => {
    expect([...ELIGIBILITY_CLASSES]).toEqual([
      'IDP_OK',
      'TRANSLATION_REQUIRED',
      'NOT_ELIGIBLE',
      'UNKNOWN',
    ])
  })
})

describe('classifyDrivingEligibility — translation-required (JAF) jurisdictions', () => {
  // The 7 jurisdictions Japan accepts only with an official Japanese translation,
  // never a Geneva IDP. Source: JAF published list.
  it.each(['CH', 'DE', 'FR', 'BE', 'MC', 'SI', 'TW'])(
    '%s requires a Japanese translation, not an IDP',
    (code) => {
      expect(classifyDrivingEligibility(code)).toBe('TRANSLATION_REQUIRED')
    },
  )

  it('the translation rule wins for jurisdictions that are ALSO Geneva parties (FR/BE/MC/SI precedence)', () => {
    // France, Belgium, Monaco and Slovenia are 1949 Geneva contracting parties,
    // but Japan binds them to the translation path — translation must be checked first.
    for (const code of ['FR', 'BE', 'MC', 'SI']) {
      expect(classifyDrivingEligibility(code)).toBe('TRANSLATION_REQUIRED')
    }
  })
})

describe('classifyDrivingEligibility — Geneva IDP jurisdictions', () => {
  it.each(['US', 'GB', 'AU', 'CA', 'KR', 'IN', 'IT', 'JP'])(
    '%s is accepted with a Geneva IDP',
    (code) => {
      expect(classifyDrivingEligibility(code)).toBe('IDP_OK')
    },
  )
})

describe('classifyDrivingEligibility — recognized but neither list', () => {
  // Real countries that are not 1949 Geneva parties and not in the translation set:
  // China, Brazil (1968 Vienna), Indonesia, Mexico, Saudi Arabia.
  it.each(['CN', 'BR', 'ID', 'MX', 'SA'])(
    '%s is a recognized country on neither list -> NOT_ELIGIBLE',
    (code) => {
      expect(classifyDrivingEligibility(code)).toBe('NOT_ELIGIBLE')
    },
  )
})

describe('classifyDrivingEligibility — unknown / malformed input', () => {
  it.each(['', ' ', 'X', 'USA', '12', 'J1', 'XX', 'QZ', 'ZZ'])(
    '%j classifies as UNKNOWN',
    (code) => {
      expect(classifyDrivingEligibility(code)).toBe('UNKNOWN')
    },
  )

  it('never throws on arbitrary input', () => {
    for (const code of ['', '🚗', 'lower', '  fr  ', 'us']) {
      expect(() => classifyDrivingEligibility(code)).not.toThrow()
    }
  })
})

describe('classifyDrivingEligibility — normalization', () => {
  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(classifyDrivingEligibility('us')).toBe('IDP_OK')
    expect(classifyDrivingEligibility('fr')).toBe('TRANSLATION_REQUIRED')
    expect(classifyDrivingEligibility('  JP  ')).toBe('IDP_OK')
    expect(classifyDrivingEligibility('cn')).toBe('NOT_ELIGIBLE')
  })
})
