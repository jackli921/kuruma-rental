import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'

const STARS = [1, 2, 3, 4, 5] as const

interface StarRatingProps {
  /** Unique radio-group name so sibling ratings stay mutually independent. */
  readonly name: string
  /** Visible label for the rating row, also the group's accessible name. */
  readonly label: string
  /** Current selection, 1-5; 0 means unset. */
  readonly value: number
  readonly onChange: (value: number) => void
  /** Builds the per-star accessible name, e.g. n => `${n} stars`. */
  readonly starLabel: (n: number) => string
}

// A 1-5 star input built from native radios (visually hidden, the star icon is the
// label) — keyboard + screen-reader reachable with real radio-group semantics, and
// stars up to the selection render filled. Controlled; the parent owns the value.
export function StarRating({ name, label, value, onChange, starLabel }: StarRatingProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex gap-0.5">
        {STARS.map((n) => (
          <label
            key={n}
            // Compact on desktop (~24px), but a >=44px tap target on touch so the
            // stars aren't a cramped hit-strip on a phone (#1301). The icon keeps its
            // size-5 look; only the hit-area grows on coarse pointers.
            className="flex cursor-pointer items-center justify-center rounded p-0.5 focus-within:ring-2 focus-within:ring-ring pointer-coarse:size-11"
          >
            <input
              type="radio"
              name={name}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={starLabel(n)}
              className="sr-only"
            />
            <Star
              aria-hidden
              className={cn(
                'size-5',
                n <= value ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40',
              )}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
