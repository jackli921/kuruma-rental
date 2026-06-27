/** ISO 4217 codes are three ASCII letters; `Intl.NumberFormat` throws on any
 *  other shape, so we reject malformed codes before constructing it. */
const CURRENCY_CODE = /^[A-Za-z]{3}$/

/** A single base locale keeps the indicative figure deterministic and gives
 *  international renters Western digit grouping with the currency's own symbol
 *  (e.g. `CN¥480`, which also disambiguates the Chinese yuan from `¥` JPY). */
const INDICATIVE_LOCALE = 'en-US'

/**
 * Format an indicative converted price for an international renter (#1070).
 *
 * The JPY amount is authoritative and is what Stripe charges; this is a
 * display-only ballpark in the renter's chosen currency. Pure — the daily FX
 * `rate` (JPY→`currency`, e.g. USD `0.0067` ⇒ 1 JPY = 0.0067 USD) is passed in
 * from a server-side cache, never fetched here.
 *
 * Returns the formatted target-currency figure rounded to whole units
 * (`"$67"`), or `null` when no indicative figure should be shown — the chosen
 * currency IS JPY, the rate is absent/invalid, the amount is non-finite, or the
 * currency code is malformed — so the caller renders the plain JPY amount alone.
 */
export function formatIndicativePrice(
  jpy: number,
  currency: string,
  rate: number | null | undefined,
): string | null {
  if (currency === 'JPY' || !CURRENCY_CODE.test(currency)) return null
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  if (!Number.isFinite(jpy)) return null

  return new Intl.NumberFormat(INDICATIVE_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(jpy * rate)
}
