import { cn } from '@/lib/utils'
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
  const { format } = useIndicative()
  const indicative = format(jpy)
  if (!indicative) return null
  return (
    <span className={cn('block font-normal text-muted-foreground text-xs', className)}>
      ≈ {indicative}
    </span>
  )
}
