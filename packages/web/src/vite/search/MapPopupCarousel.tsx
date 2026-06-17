import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { carryForwardFilters } from '@/vite/storefronts/params'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { Link } from '@tanstack/react-router'
import { Car, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { resultPriceLabel, resultTitle } from './result'

interface MapPopupCarouselProps {
  /** Every car at the selected pickup location (the map's co-located group). The
   *  pin shows one dot per location; clicking it opens this swipeable popup so a
   *  renter can flip through all cars at that store without leaving the map. */
  readonly items: SearchResultItem[]
  /** Search context threaded into each slide's detail CTA so the date range +
   *  filters survive the drill-down (#885 1b), same target as `SearchResultRow`. */
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
}

const CONTROL_CLASS =
  'absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Co-location popup carousel (#885 slice 2). Mirrors `PhotoGallery`'s index/modulo
 * cycling, but each slide is a car mini-card (photo · name · class · price · detail
 * CTA) instead of a photo. One car → a static card, no controls; many → next/prev
 * with wrap-around and a "n / total" position label. A position label replaces
 * PhotoGallery's dot row: in a narrow map popup it reads cleaner and is the same
 * affordance a screen reader needs.
 */
export function MapPopupCarousel({
  items,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: MapPopupCarouselProps) {
  const t = useTranslations('search')
  const [index, setIndex] = useState(0)

  const count = items.length
  if (count === 0) return null
  // Modulo keeps the index in range and lets prev/next wrap the ends.
  const safeIndex = ((index % count) + count) % count
  const current = items[safeIndex]
  if (!current) return null

  const photo = current.photos[0]
  const title = resultTitle(current)

  return (
    <div
      className="w-56 overflow-hidden rounded-lg border border-border bg-card text-sm shadow-md"
      // Announce the multi-car controls as one group under the store name.
      {...(count > 1 ? { role: 'group', 'aria-label': current.location.name } : {})}
    >
      <div className="relative aspect-[4/3] bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={title}
            loading="lazy"
            width={400}
            height={300}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="size-10 text-muted-foreground/30" aria-hidden />
          </div>
        )}
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndex(safeIndex - 1)}
              aria-label={t('map.popupPrev')}
              className={`${CONTROL_CLASS} left-2`}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setIndex(safeIndex + 1)}
              aria-label={t('map.popupNext')}
              className={`${CONTROL_CLASS} right-2`}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <span className="absolute right-2 bottom-2 rounded-full bg-background/80 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">
              {t('map.popupPosition', { n: safeIndex + 1, total: count })}
            </span>
          </>
        )}
      </div>

      <div
        className="flex flex-col gap-1 p-3"
        // Next/prev swaps this card's text in place; a polite live region announces
        // the new car to a screen reader instead of changing silently. Scoped to the
        // text (not the photo) so the image swap doesn't double-announce.
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold leading-tight">{title}</p>
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {current.classLabel}
          </span>
        </div>
        <p className="font-medium text-foreground">{resultPriceLabel(current, t)}</p>
        <Link
          to="/$locale/storefronts/$locationId"
          params={{ locale, locationId: current.location.locationId }}
          search={{
            from,
            to,
            ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
          }}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'mt-1 w-full')}
        >
          {t('viewStore')}
        </Link>
      </div>
    </div>
  )
}
