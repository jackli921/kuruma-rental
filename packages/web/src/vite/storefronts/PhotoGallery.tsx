import { Car, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface PhotoGalleryProps {
  /** Ordered image URLs. Empty → icon placeholder; one → a static image with no
   *  controls; many → a next/prev gallery with dot jumps. */
  readonly photos: string[]
  /** Accessible image name (the vehicle / store name). */
  readonly alt: string
}

const CONTROL_CLASS =
  'absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Inline photo gallery for renter store/vehicle cards (#659). The card data
 * already carried an array, but only `photos[0]` was rendered. Controls cycle
 * within a fixed 4:3 box so there is no layout shift, and images are lazy-loaded.
 * Single- and zero-photo states degrade gracefully (no controls / icon).
 */
export function PhotoGallery({ photos, alt }: PhotoGalleryProps) {
  const t = useTranslations('search')
  const [index, setIndex] = useState(0)

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
        <Car className="size-12 text-muted-foreground/30" aria-hidden />
      </div>
    )
  }

  const count = photos.length
  // Modulo keeps the index in range as the array length changes and lets prev/next
  // wrap around the ends.
  const safeIndex = ((index % count) + count) % count
  const current = photos[safeIndex]

  return (
    <div
      className="relative aspect-[4/3] overflow-hidden bg-muted"
      // Group the multi-photo controls under the vehicle/store name so a screen
      // reader announces them as one gallery, not loose "next/previous" buttons.
      {...(count > 1 ? { role: 'group', 'aria-label': alt } : {})}
    >
      {current && (
        // 4:3 intrinsic hint lets the browser reserve the box before load (#440);
        // h-full/w-full still drive the rendered size inside the aspect wrapper.
        <img
          src={current}
          alt={alt}
          loading="lazy"
          width={400}
          height={300}
          className="h-full w-full object-cover"
        />
      )}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIndex(safeIndex - 1)}
            aria-label={t('photoPrev')}
            className={`${CONTROL_CLASS} left-2`}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setIndex(safeIndex + 1)}
            aria-label={t('photoNext')}
            className={`${CONTROL_CLASS} right-2`}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {photos.map((photo, i) => (
              <button
                key={photo}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t('photoGoTo', { n: i + 1 })}
                aria-current={i === safeIndex}
                className={
                  i === safeIndex
                    ? 'size-2 rounded-full bg-background shadow-sm'
                    : 'size-2 rounded-full bg-background/50 shadow-sm transition hover:bg-background/80'
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
