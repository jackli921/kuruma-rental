// Default display currency inferred from the renter's locale (#1070). English and
// Chinese tourists get a home-currency ballpark next to the authoritative JPY
// charge; everyone else — Japanese renters and any unexpected locale — defaults to
// JPY, so `formatIndicativePrice` short-circuits and they see exactly today's
// JPY-only UI. The renter can always override via the selector. Takes a plain
// string (use-intl's `useLocale()` is untyped) and is self-contained by design.
export function defaultCurrencyForLocale(locale: string): string {
  if (locale === 'en') return 'USD'
  if (locale === 'zh') return 'CNY'
  return 'JPY'
}
