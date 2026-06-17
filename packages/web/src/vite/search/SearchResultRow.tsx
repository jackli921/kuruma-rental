import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { carryForwardFilters } from '@/vite/storefronts/params'
import type { SearchResultItem, SpecificSearchResult } from '@kuruma/shared/types/search-result'
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

/**
 * One flat-list row in the cross-operator vehicle search (#458). Switches on the
 * result `kind` so the CLASS_COMBO variant (#464, fast-follow) drops in without
 * touching callers — only SPECIFIC is built this slice. The projection is already
 * renter-safe (the API drops operator internals, D3). The CTA navigates to the
 * pickup store's detail page (the only detail surface today, #885 1b); card
 * focus/hover drives the map while the CTA is the sole navigation affordance.
 */
export function SearchResultRow({ item, ...ctx }: SearchResultRowProps) {
  switch (item.kind) {
    case 'SPECIFIC':
      return <SpecificRow item={item} {...ctx} />
    default:
      return null
  }
}

function SpecificRow({
  item,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
  geoLabel,
}: { readonly item: SpecificSearchResult } & Omit<SearchResultRowProps, 'item'>) {
  const t = useTranslations('search')
  const photo = item.photos[0]
  const transmissionLabel = item.transmission === 'AUTO' ? t('auto') : t('manual')

  const priceLabel = resultPriceLabel(item, t)

  return (
    <article className="flex gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-28">
        {photo ? (
          <img
            src={photo}
            alt={item.name}
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

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold leading-tight">{item.name}</h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {item.classLabel}
          </span>
        </div>

        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          <span className="font-medium text-foreground/80">{item.location.operatorName}</span>
          <span aria-hidden="true">·</span>
          <span>{item.location.name}</span>
        </p>

        {geoLabel && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Navigation className="size-4 shrink-0" aria-hidden />
            <span>{geoLabel}</span>
          </p>
        )}

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
          <Link
            to="/$locale/storefronts/$locationId"
            params={{ locale, locationId: item.location.locationId }}
            search={{
              from,
              to,
              ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
            }}
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
          >
            {t('viewStore')}
          </Link>
        </div>
      </div>
    </article>
  )
}
