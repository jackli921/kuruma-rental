import { cn } from '@/lib/utils'
import { useTranslations } from 'use-intl'
import { useIndicative } from './CurrencyProvider'

/**
 * Secondary indicative-price note (#1070): a muted `≈ $181` shown beneath the
 * authoritative JPY figure the caller renders. Returns nothing when no conversion
 * applies — JPY display currency, rates not loaded, or a malformed code — so the
 * renter then sees the JPY figure alone, exactly as today. The "charged in JPY"
 * disclaimer lives in the currency selector and on the money-commitment surfaces,
 * not on every figure.
 */
export function IndicativeNote({
  jpy,
  className,
}: {
  readonly jpy: number
  readonly className?: string
}) {
  const t = useTranslations('currency')
  const { format } = useIndicative()
  const indicative = format(jpy)
  if (!indicative) return null
  return (
    <span className={cn('block font-normal text-muted-foreground text-xs', className)}>
      {/* The visible ≈ figure comes FIRST, the screen-reader phrase second. The ≈ glyph
          (read as "almost equal to" or skipped) is aria-hidden so SR hears the spelled-out
          word exactly once. Order is load-bearing: a cell parser that splits on ≈ to read
          the authoritative JPY (real-DB E2E `yen()`) must see no converted digits BEFORE
          the glyph, so the sr-only figure must not precede it. */}
      <span aria-hidden="true">≈ {indicative}</span>
      <span className="sr-only">
        {t('approximately')} {indicative}
      </span>
    </span>
  )
}
