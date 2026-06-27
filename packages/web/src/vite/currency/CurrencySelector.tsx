import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FxRates } from '@kuruma/shared/types/fx'
import { Coins } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { useCurrency } from './CurrencyProvider'

/** The display-currency options: JPY (always, the authoritative charge currency)
 *  first, then whatever currencies the loaded snapshot offers, in its curated
 *  order. JPY is de-duplicated in case a future provider ever includes a self-rate. */
export function currencyOptions(rates: FxRates | undefined): string[] {
  const codes = rates ? Object.keys(rates.rates) : []
  return ['JPY', ...codes.filter((code) => code !== 'JPY')]
}

/**
 * Renter-facing display-currency picker (#1070). Sits in the navbar beside the
 * locale switcher. Choosing a currency only changes the indicative figures shown
 * around the JPY price — the charge is always JPY, so the menu carries that
 * disclaimer. JPY-only when rates are unavailable (a degraded fetch).
 */
export function CurrencySelector() {
  const { currency, setCurrency, rates } = useCurrency()
  const t = useTranslations('currency')
  const options = currencyOptions(rates)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            // Include the visible code so the accessible name contains the on-screen
            // label (WCAG 2.5.3 Label in Name) — a voice-control "click USD" matches.
            aria-label={`${t('label')}: ${currency}`}
          >
            <Coins className="size-4" />
            <span className="hidden sm:inline">{currency}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {/* Non-interactive info rows: plain divs, not DropdownMenuLabel — base-ui's
            GroupLabel must sit inside a Menu.Group and throws on open otherwise. */}
        <div className="px-1.5 py-1 font-normal text-muted-foreground text-xs">
          {t('disclaimer')}
        </div>
        {options.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setCurrency(code)}
            className={currency === code ? 'bg-accent font-medium' : ''}
          >
            {code}
          </DropdownMenuItem>
        ))}
        {rates && (
          <div className="px-1.5 py-1 font-normal text-muted-foreground text-xs">
            {t('asOf', { date: rates.asOf })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
