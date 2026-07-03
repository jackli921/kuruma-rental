/** The use-intl translator shape used across the search + storefront price labels. */
export type Translate = (key: string, values?: Record<string, string | number>) => string

/** The JPY figure a "from price" note converts: the daily rate (preferred) else
 *  hourly, or null for price-on-request. Shape-agnostic so every card and the map
 *  popup derive it the same way. */
export function preferredRateJpy(daily: number | null, hourly: number | null): number | null {
  return daily ?? hourly ?? null
}

/** "From ¥X / day" (or hourly, or price-on-request) — the single seam every
 *  "from price" label routes through (search rows, the map popup, storefront and
 *  available-vehicle cards) so they never drift. `t` is the `search`-namespace
 *  use-intl translator; daily is preferred, then hourly, then price-on-request. */
export function formatFromPriceLabel(
  daily: number | null,
  hourly: number | null,
  t: Translate,
): string {
  if (daily != null) return t('fromDaily', { price: daily.toLocaleString('en-US') })
  if (hourly != null) return t('fromHourly', { price: hourly.toLocaleString('en-US') })
  return t('noPrice')
}
