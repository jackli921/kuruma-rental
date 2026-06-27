import { formatJpy } from '@/lib/format'
import { useIndicative } from './CurrencyProvider'

/**
 * A whole-yen amount rendered with its indicative converted figure (#1070):
 * `¥27,000 ≈ $181`. JPY is authoritative and primary; the converted figure is a
 * muted, secondary ballpark and is omitted entirely when no conversion applies
 * (JPY display currency, rates not loaded, or a malformed code) — then the renter
 * sees exactly the JPY-only display. The "charged in JPY" disclaimer lives near the
 * currency selector and on the money-commitment surfaces, not on every figure.
 */
export function IndicativePrice({
  jpy,
  className,
}: {
  readonly jpy: number
  readonly className?: string
}) {
  const { format } = useIndicative()
  const indicative = format(jpy)
  return (
    <span className={className}>
      {formatJpy(jpy)}
      {indicative && <span className="ml-1 text-muted-foreground">≈ {indicative}</span>}
    </span>
  )
}
