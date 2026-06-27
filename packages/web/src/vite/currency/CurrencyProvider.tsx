import { formatIndicativePrice } from '@kuruma/shared/lib/indicative-price'
import type { FxRates } from '@kuruma/shared/types/fx'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useLocale } from 'use-intl'
import { fxRatesQueryOptions } from './currency-api'
import { defaultCurrencyForLocale } from './default-currency'

interface CurrencyContextValue {
  readonly currency: string
  readonly setCurrency: (currency: string) => void
  readonly rates: FxRates | undefined
}

const STORAGE_KEY = 'kuruma-display-currency'

// Default to JPY / no rates so a consumer rendered outside the provider degrades to
// JPY-only display rather than throwing (mirrors LayoutPreferenceProvider). This is
// a display-only enhancement — a missing provider must never break a price.
const CurrencyContext = createContext<CurrencyContextValue>({
  currency: 'JPY',
  setCurrency: () => {},
  rates: undefined,
})

// Read synchronously at init so a consumer never renders the locale default first
// and flips to the stored choice after mount. Client-only SPA, so no SSR hydration
// mismatch (mirrors LayoutPreferenceProvider). Any stored 3-letter code is honoured;
// `formatIndicativePrice` rejects malformed/absent rates, so a stale code is inert.
function readStoredCurrency(fallback: string): string {
  return localStorage.getItem(STORAGE_KEY) ?? fallback
}

export function CurrencyProvider({ children }: { readonly children: React.ReactNode }) {
  const locale = useLocale()
  // Display-only; a failed fetch (e.g. 503) leaves rates undefined and the whole
  // UI falls back to JPY-only — never a blocking error.
  const { data: rates } = useQuery(fxRatesQueryOptions())
  const [currency, setCurrencyState] = useState(() =>
    readStoredCurrency(defaultCurrencyForLocale(locale)),
  )

  const setCurrency = useCallback((next: string) => {
    localStorage.setItem(STORAGE_KEY, next)
    setCurrencyState(next)
  }, [])

  const value = useMemo(() => ({ currency, setCurrency, rates }), [currency, setCurrency, rates])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext)
}

/**
 * The indicative formatter bound to the renter's current currency + loaded rates.
 * `format(jpy)` returns the converted figure (`"$181"`) or null — JPY display,
 * unloaded rates, or a malformed code all yield null so the caller shows JPY alone.
 */
export function useIndicative(): { currency: string; format: (jpy: number) => string | null } {
  const { currency, rates } = useCurrency()
  const format = useCallback(
    (jpy: number) => formatIndicativePrice(jpy, currency, rates?.rates[currency]),
    [currency, rates],
  )
  return { currency, format }
}
