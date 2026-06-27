// Public surface of the currency feature (#1070) — indicative multi-currency
// display. The JPY price stays authoritative everywhere; these add a ballpark.
export { CurrencyProvider, useCurrency, useIndicative } from './CurrencyProvider'
export { IndicativePrice } from './IndicativePrice'
export { defaultCurrencyForLocale } from './default-currency'
