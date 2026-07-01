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
// Sources (PRIMARY — re-verify HERE when amending, NOT against rental-site aggregators):
//   - Who Japan accepts (operational truth): Tokyo Metropolitan Police (Keishicho),
//     https://www.keishicho.metro.tokyo.lg.jp/menkyo/menkyo/kokugai/kokugai04.html
//     (as of 2026-06-12). KEY NUANCE: being a 1949 party is NOT sufficient — Japan also
//     publishes a list of 1949 parties that do NOT issue a Geneva-FORMAT IDP (e.g. Russia
//     issues a 1968-Vienna-format permit), whose IDP is NOT valid in Japan. Those are
//     excluded from IDP_OK: the 3 with a translation arrangement (FR/BE/MC) sit in the
//     translation set; the rest classify NOT_ELIGIBLE.
//   - Who is a 1949 party (treaty status): UN Treaty Collection, chapter XI-B-1,
//     https://treaties.un.org/Pages/ViewDetailsV.aspx?src=TREATY&mtdsg_no=XI-B-1&chapter=11
//   - Vietnam is DELIBERATELY EXCLUDED (disputed; safe-fail to a warning).
//   - Aggregators (JAF mirrors, ToCoo, kart.st, niconico) reproduce the raw parties
//     roster and omit the exclusion overlay — they are what caused the original drift (#1194).

import { ISO_3166_1_ALPHA_2 } from './iso-3166-1-alpha-2'

export const ELIGIBILITY_CLASSES = [
  'IDP_OK',
  'TRANSLATION_REQUIRED',
  'NOT_ELIGIBLE',
  'UNKNOWN',
] as const

export type EligibilityClass = (typeof ELIGIBILITY_CLASSES)[number]

// Jurisdictions Japan accepts only via a JAF/embassy Japanese translation, NOT a Geneva
// IDP. FR/BE/MC are 1949 parties that do NOT issue a Geneva-format IDP, so they are
// excluded from IDP_OK. This set is checked FIRST, so the translation rule wins for any
// code also in IDP_OK — currently only SI, whose translation-set membership is being
// re-verified (#1194 follow-up). ISO 3166-1 alpha-2.
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

// 1949 Geneva Convention parties whose Geneva-FORMAT IDP Japan actually honours.
// ISO 3166-1 alpha-2, sorted. = (UN list of 1949 parties) MINUS Japan's published
// "Geneva party that does NOT issue a Geneva-format IDP" exclusion list (see header)
// MINUS Vietnam (disputed). SI also appears in the translation set, where the
// translation rule wins. Exported for the contract test that pins membership. (85 entries.)
export const IDP_OK_COUNTRIES: ReadonlySet<string> = new Set([
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
])

const ALPHA2 = /^[A-Z]{2}$/

/**
 * Classify a license-issuing jurisdiction into the document a foreign driver needs to
 * drive in Japan. Never throws; empty/malformed/unassigned input is `UNKNOWN`.
 *
 * Determinism: every classification is fully data-driven. The residual
 * NOT_ELIGIBLE-vs-UNKNOWN split reads the explicit `ISO_3166_1_ALPHA_2` set (#1216),
 * not `Intl.DisplayNames`, so the boundary is identical on Bun and workerd — a
 * prerequisite for slice 2 rendering the two classes differently (#1069).
 *
 * The translation set is checked before IDP_OK so the translation rule wins for any code
 * in both (currently only SI).
 *
 * @param countryCode ISO 3166-1 alpha-2 of the license-issuing jurisdiction (any case).
 */
export function classifyDrivingEligibility(countryCode: string): EligibilityClass {
  const code = countryCode.trim().toUpperCase()
  if (!ALPHA2.test(code)) return 'UNKNOWN'
  if (TRANSLATION_REQUIRED_COUNTRIES.has(code)) return 'TRANSLATION_REQUIRED'
  if (IDP_OK_COUNTRIES.has(code)) return 'IDP_OK'
  return ISO_3166_1_ALPHA_2.has(code) ? 'NOT_ELIGIBLE' : 'UNKNOWN'
}
