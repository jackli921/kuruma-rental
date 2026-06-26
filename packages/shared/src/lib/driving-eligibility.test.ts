import { describe, expect, it } from 'vitest'
import {
  ELIGIBILITY_CLASSES,
  IDP_OK_COUNTRIES,
  TRANSLATION_REQUIRED_COUNTRIES,
  classifyDrivingEligibility,
} from './driving-eligibility'

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

// The data IS the feature: spot-checks leave most of the list unprotected, so a
// wrong/dropped/added country could ship green. Pin the WHOLE set — any change is
// then a deliberate, reviewed diff. (code-review #1153)
describe('country reference data — full membership pinned', () => {
  it('TRANSLATION_REQUIRED is exactly the JAF 7', () => {
    expect([...TRANSLATION_REQUIRED_COUNTRIES].sort()).toEqual([
      'BE',
      'CH',
      'DE',
      'FR',
      'MC',
      'SI',
      'TW',
    ])
  })

  it('IDP_OK is the pinned 101-country Japan-accepted Geneva set (Vietnam excluded)', () => {
    const expected = [
      'AE',
      'AL',
      'AR',
      'AT',
      'AU',
      'BB',
      'BD',
      'BE',
      'BF',
      'BG',
      'BJ',
      'BN',
      'BW',
      'CA',
      'CD',
      'CF',
      'CG',
      'CI',
      'CL',
      'CU',
      'CY',
      'CZ',
      'DK',
      'DO',
      'DZ',
      'EC',
      'EE',
      'EG',
      'ES',
      'FI',
      'FJ',
      'FR',
      'GB',
      'GE',
      'GH',
      'GR',
      'GT',
      'HR',
      'HT',
      'HU',
      'IE',
      'IL',
      'IN',
      'IS',
      'IT',
      'JM',
      'JO',
      'JP',
      'KG',
      'KH',
      'KR',
      'LA',
      'LB',
      'LI',
      'LK',
      'LS',
      'LT',
      'LU',
      'MA',
      'ME',
      'MG',
      'ML',
      'MC',
      'MT',
      'MW',
      'MY',
      'NA',
      'NE',
      'NG',
      'NL',
      'NO',
      'NZ',
      'PE',
      'PG',
      'PH',
      'PL',
      'PT',
      'PY',
      'RO',
      'RS',
      'RU',
      'RW',
      'SE',
      'SG',
      'SI',
      'SK',
      'SL',
      'SM',
      'SN',
      'SY',
      'TG',
      'TH',
      'TN',
      'TR',
      'TT',
      'UG',
      'US',
      'VA',
      'VE',
      'ZA',
      'ZW',
    ]
    expect([...IDP_OK_COUNTRIES].sort()).toEqual(expected.sort())
    expect(IDP_OK_COUNTRIES.size).toBe(101)
  })

  it('the only overlap between the two sets is FR/BE/MC/SI', () => {
    const overlap = [...IDP_OK_COUNTRIES].filter((c) => TRANSLATION_REQUIRED_COUNTRIES.has(c))
    expect(overlap.sort()).toEqual(['BE', 'FR', 'MC', 'SI'])
  })

  it('known not-accepted origins are absent from IDP_OK', () => {
    for (const code of ['VN', 'CN', 'ID', 'DE', 'CH', 'TW']) {
      expect(IDP_OK_COUNTRIES.has(code)).toBe(false)
    }
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
  // Real countries that are not Japan-accepted 1949 Geneva parties and not in the
  // translation set: China, Brazil (1968 Vienna), Indonesia, Mexico, Saudi Arabia,
  // and Vietnam (disputed → safe-fail to a "verify before booking" warning).
  it.each(['CN', 'BR', 'ID', 'MX', 'SA', 'VN'])(
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
