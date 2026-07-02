import { cn } from '@/lib/utils'
import { storeInitials } from '@/vite/storefronts/monogram'

interface StoreMonogramProps {
  /** Store display name the monogram initials are derived from. */
  readonly name: string
  /** Accessible label for the tile (the initials themselves are decorative). */
  readonly label: string
  readonly className?: string
}

/**
 * Branded fallback for a storefront card that has no image (#1302). A store is a
 * rental location, not a car, so a vehicle photo would mislead (#955) and the
 * old generic glyph read as "empty/unfinished". The store's own initials on the
 * placeholder-background token (DESIGN.md) give each card a deliberate identity
 * while staying on-brand (the palette is intentionally monochrome).
 */
export function StoreMonogram({ name, label, className }: StoreMonogramProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('flex h-full w-full items-center justify-center bg-muted', className)}
    >
      <span
        aria-hidden="true"
        className="select-none text-4xl font-semibold tracking-wide text-muted-foreground"
      >
        {storeInitials(name)}
      </span>
    </div>
  )
}
