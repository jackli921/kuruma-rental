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

  it('IDP_OK is the pinned 85-country Japan-accepted Geneva set (Keishicho-excluded + Vietnam removed)', () => {
    const expected = [
      'AE',
      'AR',
      'AT',
      'AU',
      'BB',
      'BF',
      'BJ',
      'BN',
      'CA',
      'CD',
      'CF',
      'CG',
      'CL',
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
      'GB',
      'GE',
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
      'LK',
      'LS',
      'LT',
      'LU',
      'MA',
      'MG',
      'ML',
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
    ]
    expect([...IDP_OK_COUNTRIES].sort()).toEqual(expected.sort())
    expect(IDP_OK_COUNTRIES.size).toBe(85)
  })

  it('the only overlap between the two sets is SI (Slovenia)', () => {
    // FR/BE/MC left IDP_OK (their IDPs are not Geneva-format → not valid in Japan);
    // SI is the lone remaining dual-member (its translation-set membership is being
    // re-verified separately — see #1194 follow-up).
    const overlap = [...IDP_OK_COUNTRIES].filter((c) => TRANSLATION_REQUIRED_COUNTRIES.has(c))
    expect(overlap.sort()).toEqual(['SI'])
  })

  it('known not-accepted origins are absent from IDP_OK', () => {
    for (const code of [
      'VN',
      'CN',
      'ID',
      'DE',
      'CH',
      'TW',
      // Keishicho "Geneva parties that do NOT issue Geneva-format IDPs" — invalid in Japan:
      'FR',
      'BE',
      'MC',
      'AL',
      'BD',
      'BG',
      'BW',
      'CI',
      'CU',
      'GH',
      'LI',
      'ME',
      'RS',
      'RU',
      'RW',
      'ZW',
    ]) {
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

  it('the translation path applies to FR/BE/MC/SI (translation checked before IDP_OK)', () => {
    // All four are 1949 Geneva parties bound to the translation path. FR/BE/MC are no
    // longer in IDP_OK (their IDPs are not Geneva-format); SI remains in both, so the
    // translation-first precedence still governs it.
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

describe('classifyDrivingEligibility — 1949 parties that issue non-Geneva-format IDPs', () => {
  // These ARE 1949 Geneva Convention parties, but Japan (Tokyo Metropolitan Police,
  // 2026-06-12) lists them as NOT issuing Geneva-FORMAT IDPs, so their IDP is not
  // valid for driving in Japan, and they have no translation arrangement (unlike
  // FR/BE/MC) — the renter must convert to a JP licence. Classify NOT_ELIGIBLE.
  // RU (Russia) is the case reported in #1194.
  it.each(['RU', 'AL', 'BD', 'BG', 'BW', 'CI', 'CU', 'GH', 'LI', 'ME', 'RS', 'RW', 'ZW'])(
    '%s is a 1949 party whose IDP Japan does not accept -> NOT_ELIGIBLE',
    (code) => {
      expect(classifyDrivingEligibility(code)).toBe('NOT_ELIGIBLE')
    },
  )
})

describe('classifyDrivingEligibility — non-official codes ICU may recognize (#1216)', () => {
  // The residual NOT_ELIGIBLE-vs-UNKNOWN split must be identical on every runtime.
  // These alpha-2 codes are recognized by SOME ICU versions (Bun local, e.g.) but are
  // NOT officially-assigned ISO 3166-1 countries — they are exceptionally-reserved
  // unions/aliases or withdrawn historical codes — so no renter can hold a license
  // from one. They must classify UNKNOWN deterministically, not follow ICU's
  // runtime-dependent recognized-region set (workerd differs). This is the #1216 bug.
  it.each([
    'EU', // European Union (exceptionally reserved)
    'UK', // alias for GB (exceptionally reserved; official code is GB)
    'EZ', // Eurozone (exceptionally reserved)
    'FX', // Metropolitan France (exceptionally reserved)
    'IC', // Canary Islands (exceptionally reserved)
    'AC', // Ascension Island (exceptionally reserved)
    'AN', // Netherlands Antilles (withdrawn 2010)
    'SU', // USSR (withdrawn)
    'YU', // Yugoslavia (withdrawn)
    'CS', // Serbia and Montenegro (withdrawn)
    'ZR', // Zaire -> now CD (withdrawn)
    'TP', // East Timor -> now TL (withdrawn)
  ])('%s is not an officially-assigned country -> UNKNOWN', (code) => {
    expect(classifyDrivingEligibility(code)).toBe('UNKNOWN')
  })
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
