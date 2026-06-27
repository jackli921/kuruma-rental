import { IndicativeNote } from '@/vite/currency'
import { type AggregateEntry, RatingBadge } from '@/vite/reviews'
import { ClassSummaryBadges } from '@/vite/storefronts/ClassSummaryBadges'
import type { StorefrontCardData } from '@/vite/storefronts/api'
import { carryForwardFilters } from '@/vite/storefronts/params'
import { turnaroundHours } from '@/vite/storefronts/turnaround'
import { Link } from '@tanstack/react-router'
import { Clock, MapPin, Store } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface StorefrontCardProps {
  readonly storefront: StorefrontCardData
  /** Pickup/return strings forwarded so the date range survives the click. */
  readonly from: string
  readonly to: string
  /** Active result filters forwarded so they survive the drill-down (#499). */
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  /** Chosen region slug forwarded so the nearest-first context survives the drill-down (#840). */
  readonly region?: string | undefined
  /** Great-circle km from the search anchor (#840); null/absent hides the label. */
  readonly distanceKm?: number | null
  /** #1085 slice 5: the operator's review aggregate. `undefined` = batch in
   *  flight (skeleton), `null` = no published reviews, entry = ★ avg (count). */
  readonly operatorRating?: AggregateEntry | null | undefined
}

/**
 * One storefront result card (#391). Renders the demo target string —
 * "Best Car Rental Osaka — Compact ×4, Minivan ×2, from ¥4,500/day" — from the
 * store name, class summaries, and min price. Daily price is preferred; a store
 * with only hourly-priced cars shows the hourly fallback (§3 item 5).
 */
export function StorefrontCard({
  storefront,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
  distanceKm,
  operatorRating,
}: StorefrontCardProps) {
  const t = useTranslations('search')
  const locale = useLocale()

  const priceLabel =
    storefront.fromDailyPriceJpy != null
      ? t('fromDaily', { price: storefront.fromDailyPriceJpy.toLocaleString('en-US') })
      : storefront.fromHourlyPriceJpy != null
        ? t('fromHourly', { price: storefront.fromHourlyPriceJpy.toLocaleString('en-US') })
        : t('noPrice')
  // The "from" JPY figure the indicative note converts (daily preferred, else hourly).
  const fromPriceJpy = storefront.fromDailyPriceJpy ?? storefront.fromHourlyPriceJpy ?? null

  return (
    <Link
      to="/$locale/storefronts/$locationId"
      params={{ locale, locationId: storefront.locationId }}
      search={{
        from,
        to,
        ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
      }}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {/*
          A storefront is a rental location, not a car: showing a vehicle photo here
          read as "this is the store" (#955). Until a real store image field exists,
          show a location placeholder — a Store glyph, distinct from the PhotoGallery
          Car fallback so it unambiguously signals "location".
        */}
        <div
          role="img"
          aria-label={t('storeImagePlaceholder')}
          className="flex h-full w-full items-center justify-center"
        >
          <Store className="size-12 text-muted-foreground/30" aria-hidden="true" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{storefront.operatorName}</p>
          <div className="mt-0.5">
            <RatingBadge entry={operatorRating} />
          </div>
          <h2 className="mt-1 text-lg font-semibold leading-tight">{storefront.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="line-clamp-1">{storefront.address}</span>
          </p>
          {distanceKm != null && (
            <p className="mt-1 text-xs font-medium text-foreground">
              {t('distance', { km: distanceKm.toFixed(1) })}
            </p>
          )}
        </div>
        <ClassSummaryBadges summaries={storefront.classSummaries} />
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          {t('turnaround', { hours: turnaroundHours(storefront.turnaroundMinutes) })}
        </p>
        <div className="mt-auto">
          <p className="text-base font-semibold text-foreground">{priceLabel}</p>
          {fromPriceJpy != null && <IndicativeNote jpy={fromPriceJpy} />}
        </div>
      </div>
    </Link>
  )
}
