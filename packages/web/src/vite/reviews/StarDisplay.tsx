import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'

const STARS = [1, 2, 3, 4, 5] as const

interface StarDisplayProps {
  /** 1-5 whole stars. */
  readonly value: number
  /** Accessible name for the row, e.g. "5 out of 5 stars". */
  readonly label: string
}

// Readonly star row (review-display slice) — the input counterpart is StarRating.
// A single labelled group; individual stars are aria-hidden decoration.
export function StarDisplay({ value, label }: StarDisplayProps) {
  return (
    <div className="flex gap-0.5" role="img" aria-label={label}>
      {STARS.map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-4',
            n <= value ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </div>
  )
}
