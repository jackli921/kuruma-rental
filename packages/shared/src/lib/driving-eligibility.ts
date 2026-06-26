// Pure driving-eligibility classifier for foreign-license holders driving in Japan
// (#1069). Japan legally accepts two document paths:
//   1. A 1949 Geneva Convention International Driving Permit (IDP) + home license.
//   2. For a small set of jurisdictions whose home countries are NOT 1949 Geneva
//      parties (or are bound by a bilateral arrangement) — an official Japanese
//      translation of the home license (issued by JAF or the embassy/consulate) +
//      home license. An IDP is NOT accepted for these.
//
// This is GUIDANCE plus a recorded declaration, never verification — the operator
// physically inspects the document at pickup. Functional core: pure, total, no I/O.
//
// Sources (lists change rarely; re-verify currency when amending):
//   - Translation-required set: JAF published list — Switzerland, Germany, France,
//     Belgium, Monaco, Slovenia, Taiwan. https://www.jaf.or.jp/common/visitor-procedures
//   - Geneva 1949 contracting parties (IDP accepted): UN Treaty Collection /
//     Wikipedia "Geneva Convention on Road Traffic" (102 parties, as of 2025-03).

export const ELIGIBILITY_CLASSES = [
  'IDP_OK',
  'TRANSLATION_REQUIRED',
  'NOT_ELIGIBLE',
  'UNKNOWN',
] as const

export type EligibilityClass = (typeof ELIGIBILITY_CLASSES)[number]

// The 7 jurisdictions whose home licenses need a JAF/embassy Japanese translation,
// NOT a Geneva IDP. This is the binding rule even for the four that are also Geneva
// parties (FR/BE/MC/SI), so this set is checked FIRST. ISO 3166-1 alpha-2.
const TRANSLATION_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'CH',
  'DE',
  'FR',
  'BE',
  'MC',
  'SI',
  'TW',
])

// 1949 Geneva Convention on Road Traffic contracting parties — Japan accepts an IDP
// issued by these. ISO 3166-1 alpha-2. FR/BE/MC/SI also appear here, but the
// translation rule above wins. (102 parties.)
const IDP_OK_COUNTRIES: ReadonlySet<string> = new Set([
  'AL',
  'DZ',
  'AR',
  'AU',
  'AT',
  'BD',
  'BB',
  'BE',
  'BJ',
  'BW',
  'BN',
  'BG',
  'BF',
  'KH',
  'CA',
  'CF',
  'CL',
  'CG',
  'CI',
  'HR',
  'CU',
  'CY',
  'CZ',
  'CD',
  'DK',
  'DO',
  'EC',
  'EG',
  'EE',
  'FJ',
  'FI',
  'FR',
  'GE',
  'GH',
  'GR',
  'GT',
  'HT',
  'VA',
  'HU',
  'IS',
  'IN',
  'IE',
  'IL',
  'IT',
  'JM',
  'JP',
  'JO',
  'KG',
  'LA',
  'LB',
  'LS',
  'LI',
  'LT',
  'LU',
  'MG',
  'MW',
  'MY',
  'ML',
  'MT',
  'MC',
  'ME',
  'MA',
  'NA',
  'NL',
  'NZ',
  'NE',
  'NG',
  'NO',
  'PG',
  'PY',
  'PE',
  'PH',
  'PL',
  'PT',
  'RO',
  'RU',
  'RW',
  'SM',
  'SN',
  'RS',
  'SL',
  'SG',
  'SK',
  'SI',
  'ZA',
  'KR',
  'ES',
  'LK',
  'SE',
  'SY',
  'TH',
  'TG',
  'TT',
  'TN',
  'TR',
  'UG',
  'AE',
  'GB',
  'US',
  'VE',
  'VN',
  'ZW',
])

const ALPHA2 = /^[A-Z]{2}$/

// ICU recognizes the assigned ISO 3166-1 regions; with `fallback: 'none'` an
// unassigned code returns undefined and a structurally invalid one throws. The lone
// quirk is the reserved code ZZ ("unknown region"), which ICU labels rather than
// drops — treat that label as unrecognized too.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

function isRecognizedCountry(code: string): boolean {
  let name: string | undefined
  try {
    name = regionNames.of(code)
  } catch {
    return false
  }
  return name !== undefined && name !== 'Unknown Region'
}

/**
 * Classify a license-issuing jurisdiction into the document a foreign driver needs
 * to drive in Japan. Pure and total — never throws; empty/malformed/unassigned input
 * is `UNKNOWN`. The translation-required set is checked before the Geneva IDP set so
 * the binding rule wins for the jurisdictions on both (FR/BE/MC/SI).
 *
 * @param countryCode ISO 3166-1 alpha-2 of the license-issuing jurisdiction (any case).
 */
export function classifyDrivingEligibility(countryCode: string): EligibilityClass {
  const code = countryCode.trim().toUpperCase()
  if (!ALPHA2.test(code)) return 'UNKNOWN'
  if (TRANSLATION_REQUIRED_COUNTRIES.has(code)) return 'TRANSLATION_REQUIRED'
  if (IDP_OK_COUNTRIES.has(code)) return 'IDP_OK'
  return isRecognizedCountry(code) ? 'NOT_ELIGIBLE' : 'UNKNOWN'
}
