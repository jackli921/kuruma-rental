import { useFeatureFlag } from '@/vite/config'
import {
  RatingBadge,
  ReviewList,
  operatorReviewsInfiniteQueryOptions,
  reviewAggregatesQueryOptions,
} from '@/vite/reviews'
import { AvailableVehicleCard } from '@/vite/storefronts/AvailableVehicleCard'
import { ClassOfferingCard } from '@/vite/storefronts/ClassOfferingCard'
import type { StorefrontDetailData } from '@/vite/storefronts/api'
import { carryForwardFilters } from '@/vite/storefronts/params'
import { turnaroundHours } from '@/vite/storefronts/turnaround'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Clock, MapPin } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface StorefrontDetailViewProps {
  readonly detail: StorefrontDetailData
  /** Date range to preserve on the "back to search" link. */
  readonly from: string
  readonly to: string
  /** Active result filters preserved on the "back to search" link (#499). */
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  /** Chosen region slug preserved on the back link so nearest-first survives a return (#840). */
  readonly region?: string | undefined
}

/**
 * Storefront drill-down (#391). Shows the store header and its available
 * vehicles for the selected range. The API already sorts vehicles by class, so
 * the grid renders same-class cars adjacently (the grouped-by-class UI, §4).
 * A known-but-full store renders the empty-state copy, not a 404.
 */
export function StorefrontDetailView({
  detail,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: StorefrontDetailViewProps) {
  const t = useTranslations('search')
  const locale = useLocale()
  const reviewsEnabled = useFeatureFlag('REVIEWS')
  const { storefront, vehicles, classOfferings } = detail

  // #1085 slice 5: one query for the storefront's operator badge + one batched
  // query for every visible vehicle's class badge. The class fetch drops null
  // classIds — those cards render no badge at all — and the queryOptions hook
  // bypasses the network when the resulting set is empty.
  const { data: operatorRatings } = useQuery(
    reviewAggregatesQueryOptions('operators', [storefront.operatorId]),
  )
  const classIds = vehicles.map((v) => v.classId).filter((id): id is string => id !== null)
  const { data: classRatings } = useQuery(reviewAggregatesQueryOptions('classes', classIds))
  // #1449: paginated "load more" over the operator's reviews. Flatten the pages into one
  // list for render; the cursor lives in react-query's page params, not component state.
  const {
    data: reviewPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    ...operatorReviewsInfiniteQueryOptions(storefront.operatorId),
    enabled: reviewsEnabled,
  })
  const operatorReviews = reviewPages?.pages.flatMap((page) => page.reviews)

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        to="/$locale/search"
        params={{ locale }}
        search={{
          from,
          to,
          ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
        }}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('detail.backToSearch')}
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">{storefront.operatorName}</p>
        <div className="mt-1">
          <RatingBadge entry={operatorRatings?.[storefront.operatorId]} size="md" />
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{storefront.name}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          {storefront.address}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0" />
          {t('turnaround', { hours: turnaroundHours(storefront.turnaroundMinutes) })}
        </p>
      </header>

      <h2 className="mb-4 text-xl font-semibold tracking-tight">{t('detail.availableVehicles')}</h2>
      {vehicles.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{t('detail.noVehicles')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <AvailableVehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              locationId={storefront.locationId}
              from={from}
              to={to}
              classRating={vehicle.classId !== null ? classRatings?.[vehicle.classId] : undefined}
              classFilter={classFilter}
              pickupLocationId={pickupLocationId}
              region={region}
            />
          ))}
        </div>
      )}

      {/* #464: class-combo deals for this store. The section identity comes from
          `storefront` (each offering redundantly echoes its location, but the
          store owns the pickup id — deferring to `offering.location` would let a
          future mismatch silently mis-route the booking). */}
      {classOfferings.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-semibold tracking-tight">{t('detail.classDeals')}</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {classOfferings.map((offering) => (
              <ClassOfferingCard
                key={offering.classId}
                offering={offering}
                locationId={storefront.locationId}
                from={from}
                to={to}
                classFilter={classFilter}
                pickupLocationId={pickupLocationId}
                region={region}
              />
            ))}
          </div>
        </section>
      )}

      {operatorReviews !== undefined ? (
        <ReviewList
          reviews={operatorReviews}
          hasMore={hasNextPage}
          onLoadMore={() => {
            void fetchNextPage()
          }}
          isLoadingMore={isFetchingNextPage}
        />
      ) : null}
    </div>
  )
}
