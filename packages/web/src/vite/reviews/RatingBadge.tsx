import { cn } from '@/lib/utils'
import type { AggregateEntry } from '@/vite/reviews/api'
import { useTranslations } from 'use-intl'

type Size = 'sm' | 'md'

interface RatingBadgeProps {
  /** undefined → skeleton (in-flight), null → no-reviews-yet, value → ★ avg (count). */
  readonly entry: AggregateEntry | null | undefined
  readonly size?: Size
}

// #1085 slice 5. The three input branches each map to a distinct render so the
// "no reviews yet" state can't be confused with "still loading" — the test pins
// each branch by exact text/role.
export function RatingBadge({ entry, size = 'sm' }: RatingBadgeProps) {
  const t = useTranslations('reviews.aggregate')
  const textClass = cn('text-muted-foreground', size === 'sm' ? 'text-xs' : 'text-sm')

  if (entry === undefined) {
    return (
      <span
        aria-hidden="true"
        data-testid="rating-badge-skeleton"
        className={cn('inline-block h-3 w-16 animate-pulse rounded bg-muted', textClass)}
      />
    )
  }

  if (entry === null) {
    const label = t('noReviews')
    return (
      <span aria-label={label} className={textClass}>
        {label}
      </span>
    )
  }

  const display = t('rating', { avg: entry.avg, count: entry.count })
  const aria = t('ratingAria', { avg: entry.avg, count: entry.count })
  return (
    <span aria-label={aria} className={textClass}>
      {display}
    </span>
  )
}
