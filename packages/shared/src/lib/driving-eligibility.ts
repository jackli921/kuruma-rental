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
// SAFE-FAIL PRINCIPLE: when a jurisdiction is genuinely disputed across sources, it
// is left OFF the IDP_OK set so it classifies NOT_ELIGIBLE → a "verify before
// booking" warning. Wrongly warning an eligible driver is mild friction; wrongly
// clearing an ineligible one is a refused car at the counter — the exact failure
// this feature exists to prevent. Err toward the warning.
//
// Sources (primary — re-verify when amending):
//   - UN Treaty Collection, Convention on Road Traffic (Geneva 1949), participant list
//     XI-B-1: https://treaties.un.org/pages/ViewDetailsV.aspx?mtdsg_no=XI-B-1&chapter=11
//   - Japan NPA "List of Contracting States to the Geneva Convention" — the operational
//     authority for which IDPs Japan accepts.
//   - Translation-required set (7): JAF published list — Switzerland, Germany, France,
//     Belgium, Monaco, Slovenia, Taiwan.
//   - IDP-accepted set: Japan-accepted 1949 Geneva parties. Russia (RU) and Vietnam (VN)
//     are DELIBERATELY EXCLUDED — both are 1968 Vienna parties, NOT 1949 Geneva, so Japan
//     does not accept their IDP (#1194); per safe-fail they classify NOT_ELIGIBLE. Georgia
//     (GE) and Kyrgyzstan (KG) were verified as genuine 1949 Geneva parties (2026-06,
//     UN Treaty Collection) and are retained.

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
// Exported for the contract test that pins the full membership (data IS the feature).
export const TRANSLATION_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'CH',
  'DE',
  'FR',
  'BE',
  'MC',
  'SI',
  'TW',
])

// Japan-accepted 1949 Geneva Convention parties — Japan accepts an IDP issued by
// these. ISO 3166-1 alpha-2. FR/BE/MC/SI also appear here, but the translation rule
// above wins. Russia and Vietnam are deliberately excluded (see header). (100 entries.)
// Exported for the contract test that pins the full membership.
export const IDP_OK_COUNTRIES: ReadonlySet<string> = new Set([
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
  'ZW',
])

const ALPHA2 = /^[A-Z]{2}$/

// ISO 3166-1 alpha-2 user-assigned / reserved ranges — never a real country, so no
// renter could legitimately hold a license from one. Reject these up front rather
// than depend on an ICU display-label (ZZ in particular resolves to a generic label
// instead of undefined, and that label is locale/version-dependent).
function isUserAssignedCode(code: string): boolean {
  return (
    code === 'AA' ||
    code === 'ZZ' ||
    (code >= 'QM' && code <= 'QZ') ||
    (code >= 'XA' && code <= 'XZ')
  )
}

// ICU recognizes the assigned ISO 3166-1 regions; with `fallback: 'none'` an
// unassigned code returns undefined and a structurally invalid one throws.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

function isRecognizedCountry(code: string): boolean {
  if (isUserAssignedCode(code)) return false
  try {
    return regionNames.of(code) !== undefined
  } catch {
    return false
  }
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
