/**
 * Indicative FX rate table for #1070 — converting the authoritative JPY price to
 * a renter's chosen display currency. Display-only: the charge is always JPY (the
 * only currency Stripe settles here), so these rates never touch the money path.
 *
 * `base` is always `'JPY'`. Each `rates` entry is JPY→code: USD `0.0067` means
 * 1 JPY = 0.0067 USD. `asOf` is the YYYY-MM-DD the snapshot represents, surfaced
 * so the web can show "rates as of …" next to the indicative figure.
 */
export interface FxRates {
  base: 'JPY'
  asOf: string
  rates: Readonly<Record<string, number>>
}
