import { readLocalStorage, writeLocalStorage } from '@/lib/safe-storage'
import { isMultiCurrencyEnabled } from '@/vite/config'
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

// The renter's explicitly-chosen code, read synchronously at init so a stored
// choice never flashes the default first. Normalized to upper-case: rate keys are
// upper-case and `formatIndicativePrice` canonicalizes, so a lower-case stored or
// tampered value would otherwise silently miss its rate. `null` = no choice yet.
function readStoredCurrency(): string | null {
  return readLocalStorage(STORAGE_KEY)?.toUpperCase() ?? null
}

export function CurrencyProvider({ children }: { readonly children: React.ReactNode }) {
  const locale = useLocale()
  // Display-only; a failed fetch (e.g. 503) leaves rates undefined and the whole
  // UI falls back to JPY-only — never a blocking error. Skipped entirely when the
  // multi-currency feature is gated off (#1070): no picker, no notes, so no reason
  // to pay for the FX snapshot.
  const { data: rates } = useQuery({ ...fxRatesQueryOptions(), enabled: isMultiCurrencyEnabled() })
  const [stored, setStored] = useState(readStoredCurrency)
  // An explicit choice wins; until then the currency is DERIVED from the locale
  // every render, so switching language updates the indicative default instead of
  // freezing it at the locale present on first mount.
  const currency = stored ?? defaultCurrencyForLocale(locale)

  const setCurrency = useCallback((next: string) => {
    const code = next.toUpperCase()
    writeLocalStorage(STORAGE_KEY, code)
    setStored(code)
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
  // The single conversion chokepoint. Gated off (#1070) → every `format` returns
  // null, so IndicativeNote and the two direct callers (which already branch on a
  // null result) show the JPY figure alone. One gate covers every price surface.
  const enabled = isMultiCurrencyEnabled()
  const format = useCallback(
    (jpy: number) =>
      enabled ? formatIndicativePrice(jpy, currency, rates?.rates[currency]) : null,
    [enabled, currency, rates],
  )
  return { currency, format }
}
