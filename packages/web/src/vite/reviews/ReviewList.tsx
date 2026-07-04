import { useFeatureFlag } from '@/vite/config'
import { StarDisplay } from '@/vite/reviews/StarDisplay'
import type { PublicReviewDto } from '@/vite/reviews/api'
import { useFormatter, useTranslations } from 'use-intl'

interface ReviewListProps {
  readonly reviews: readonly PublicReviewDto[]
  /** #1449 keyset pagination. When true, a "load more" button is shown; `onLoadMore`
   *  fetches the next page and `isLoadingMore` disables the button while it is in flight.
   *  Omit all three for a non-paginated list (the button never renders). */
  readonly hasMore?: boolean
  readonly onLoadMore?: () => void
  readonly isLoadingMore?: boolean
}

// Public review list (review-display slice, #1067). Flag-gated like RatingBadge so no
// review text surfaces until reviews go live. Reviewer identity is intentionally
// anonymous ("Verified renter") — the epic non-goal forbids public renter profiles.
export function ReviewList({ reviews, hasMore, onLoadMore, isLoadingMore }: ReviewListProps) {
  const t = useTranslations('reviews.list')
  const tDim = useTranslations('reviews.form.dimension')
  const format = useFormatter()
  const reviewsEnabled = useFeatureFlag('REVIEWS')

  if (!reviewsEnabled) return null

  return (
    <section aria-labelledby="reviews-heading" className="mt-12">
      <h2 id="reviews-heading" className="mb-4 text-xl font-semibold tracking-tight">
        {t('heading')}
      </h2>
      {reviews.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-6">
          {reviews.map((r) => (
            <li key={r.id} className="border-b pb-6 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <StarDisplay value={r.overall} label={t('overallAria', { n: r.overall })} />
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(r.publishedAt), {
                    year: 'numeric',
                    month: 'short',
                    timeZone: 'Asia/Tokyo',
                  })}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{t('reviewer')}</p>
              {r.comment ? <p className="mt-2 whitespace-pre-line">{r.comment}</p> : null}
              {Object.keys(r.subRatings).length > 0 ? (
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {Object.entries(r.subRatings).map(([dim, stars]) => (
                    <div key={dim} className="flex items-center gap-2">
                      <dt className="text-muted-foreground">{tDim.has(dim) ? tDim(dim) : dim}</dt>
                      <dd>{t('dimensionValue', { n: stars })}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {hasMore && onLoadMore ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
          >
            {isLoadingMore ? t('loadingMore') : t('loadMore')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
