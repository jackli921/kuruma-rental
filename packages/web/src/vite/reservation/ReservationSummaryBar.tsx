import { formatJpy } from '@/lib/format'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'

interface ReservationSummaryBarProps {
  /** Running estimate total in yen — the authoritative JPY figure shown on Confirm. */
  readonly totalJpy: number
  /** Back affordance for this step (a Back button, or the step-1 back-to-listing link). */
  readonly back: ReactNode
  /** Primary advance control (Continue / To payment). */
  readonly next: ReactNode
}

/**
 * Sticky bottom action bar for the reservation wizard (#1299). Two mobile
 * conversion fixes in one persistent bar: it surfaces the running estimate total
 * on every step (before #1299 the total was passed only to ConfirmStep, step 4),
 * and it keeps Back/Continue reachable without scrolling to the end of a long
 * step. `sticky bottom-0` pins it to the viewport bottom while the step scrolls;
 * the buttons inherit the >=44px touch floor from the Button primitive (#1298).
 *
 * JPY only by design: this is a quick-glance running total, and JPY is the
 * authoritative charge. The full itemised breakdown and the optional indicative
 * "≈ $" conversion stay on Confirm (#1070), so this bar needs no currency provider.
 */
export function ReservationSummaryBar({ totalJpy, back, next }: ReservationSummaryBarProps) {
  const t = useTranslations('reservation')
  return (
    <div
      data-slot="reservation-summary-bar"
      className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border bg-background/95 py-3 backdrop-blur supports-backdrop-filter:bg-background/80"
    >
      <div className="flex flex-col">
        {/* Its own short label ("Total"), distinct from confirm.total ("Estimated total"):
            the bar rides above the Confirm breakdown, so a duplicate "Estimated total" would
            render twice on that step. Same figure, terser glance-label. */}
        <span className="text-xs text-muted-foreground">{t('summary.total')}</span>
        <span className="text-lg font-semibold tabular-nums">{formatJpy(totalJpy)}</span>
      </div>
      <div className="flex items-center gap-2">
        {back}
        {next}
      </div>
    </div>
  )
}
