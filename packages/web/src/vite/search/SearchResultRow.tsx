import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { carryForwardFilters } from '@/vite/storefronts/params'
import type {
  ClassComboSearchResult,
  ResultLocation,
  SearchResultItem,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import { Link } from '@tanstack/react-router'
import { Car, MapPin, Navigation, Settings2, Users } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { resultPriceLabel } from './result'

interface SearchResultRowProps {
  readonly item: SearchResultItem
  /** Search context carried into the detail CTA so dates + filters survive the drill-down (#885 1b). */
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
  /** One-line "{area}, {prefecture} · {km} km away" geo context (#885 slice 3a). */
  readonly geoLabel?: string | null
}

/** A concrete row variant's props: its narrowed `item` plus the shared search context. */
type RowCardProps<T extends SearchResultItem> = { readonly item: T } & Omit<
  SearchResultRowProps,
  'item'
>

/**
 * One flat-list row in the cross-operator vehicle search (#458). Switches on the
 * result `kind`: a SPECIFIC row is one physical car, a CLASS_COMBO row (#464) is a
 * class with an inventory count, exact car assigned on pickup day. The projection is
 * already renter-safe (the API drops operator internals, D3). The CTA navigates to the
 * pickup store's detail page (the only detail surface today, #885 1b); card
 * focus/hover drives the map while the CTA is the sole navigation affordance. A future
 * `kind` renders nothing rather than crash until its row is built.
 */
export function SearchResultRow({ item, ...ctx }: SearchResultRowProps) {
  switch (item.kind) {
    case 'SPECIFIC':
      return <SpecificRow item={item} {...ctx} />
    case 'CLASS_COMBO':
      return <ClassComboRow item={item} {...ctx} />
    default:
      return null
  }
}

/** Square thumbnail with a car-icon placeholder — shared by every row variant. */
function RowThumbnail({
  photo,
  alt,
}: { readonly photo: string | undefined; readonly alt: string }) {
  return (
    <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-28">
      {photo ? (
        <img
          src={photo}
          alt={alt}
          // 1:1 intrinsic hint lets the browser reserve the box before load (#846);
          // h-full/w-full still drive the rendered size inside the square wrapper.
          width={300}
          height={300}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Car className="size-8 text-muted-foreground/30" />
        </div>
      )}
    </div>
  )
}

/** "{operator} · {store}" line — keeps a cross-operator list legible. */
function RowLocationLine({ location }: { readonly location: ResultLocation }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <MapPin className="size-4 shrink-0" />
      <span className="font-medium text-foreground/80">{location.operatorName}</span>
      <span aria-hidden="true">·</span>
      <span>{location.name}</span>
    </p>
  )
}

/** Optional "{area}, {prefecture} · {km} km away" geo line (#885 slice 3a). */
function RowGeoLine({ geoLabel }: { readonly geoLabel: string | null | undefined }) {
  if (!geoLabel) return null
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Navigation className="size-4 shrink-0" aria-hidden />
      <span>{geoLabel}</span>
    </p>
  )
}

/** "View cars" CTA to the pickup store, carrying the date range + active filters forward. */
function RowDetailCta({
  location,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: { readonly location: ResultLocation } & Omit<SearchResultRowProps, 'item'>) {
  const t = useTranslations('search')
  return (
    <Link
      to="/$locale/storefronts/$locationId"
      params={{ locale, locationId: location.locationId }}
      search={{
        from,
        to,
        ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
      }}
      className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
    >
      {t('viewStore')}
    </Link>
  )
}

function SpecificRow({ item, ...ctx }: RowCardProps<SpecificSearchResult>) {
  const t = useTranslations('search')
  const transmissionLabel = item.transmission === 'AUTO' ? t('auto') : t('manual')
  const priceLabel = resultPriceLabel(item, t)

  return (
    <article className="flex gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <RowThumbnail photo={item.photos[0]} alt={item.name} />

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold leading-tight">{item.name}</h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {item.classLabel}
          </span>
        </div>

        <RowLocationLine location={item.location} />
        <RowGeoLine geoLabel={ctx.geoLabel} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: item.seats })}
          </span>
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" />
            {transmissionLabel}
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <p className="text-base font-semibold text-foreground">{priceLabel}</p>
          <RowDetailCta location={item.location} {...ctx} />
        </div>
      </div>
    </article>
  )
}

function ClassComboRow({ item, ...ctx }: RowCardProps<ClassComboSearchResult>) {
  const t = useTranslations('search')
  const priceLabel = resultPriceLabel(item, t)
  // A class card can size to 0 when demand has eaten the whole float (the API emits
  // max(0, cap − demand)). Show it as sold out — visible but unbookable — rather than
  // a "0 available" card with a live CTA into an empty class.
  const soldOut = item.availableCount === 0

  return (
    <article className="flex gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <RowThumbnail photo={item.photos[0]} alt={item.classLabel} />

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          {/* The class label IS the title here (no single car), so the pill carries the
              inventory count instead of the class name. */}
          <h3 className="text-base font-semibold leading-tight">{item.classLabel}</h3>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
              soldOut ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground',
            )}
          >
            {soldOut ? t('comboSoldOut') : t('comboAvailable', { count: item.availableCount })}
          </span>
        </div>

        <RowLocationLine location={item.location} />
        <RowGeoLine geoLabel={ctx.geoLabel} />

        {/* Seats only — a class spans transmissions, so the gearbox is decided at pickup. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: item.seats })}
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <p className="text-base font-semibold text-foreground">{priceLabel}</p>
          {/* No CTA when sold out — the store has nothing bookable in this class right now. */}
          {!soldOut && <RowDetailCta location={item.location} {...ctx} />}
        </div>
      </div>
    </article>
  )
}
