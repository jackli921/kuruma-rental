import { Link } from '@/i18n/routing'
import { Car, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { StorefrontCardData } from '../api'
import { ClassSummaryBadges } from './ClassSummaryBadges'

interface StorefrontCardProps {
  storefront: StorefrontCardData
  /** Pickup/return strings forwarded so the date range survives the click. */
  from: string
  to: string
}

/**
 * One storefront result card (#391). Renders the demo target string —
 * "Best Car Rental Osaka — Compact ×4, Minivan ×2, from ¥4,500/day" — from the
 * store name, class summaries, and min price. Daily price is preferred; a store
 * with only hourly-priced cars shows the hourly fallback (§3 item 5).
 */
export function StorefrontCard({ storefront, from, to }: StorefrontCardProps) {
  const t = useTranslations('search')
  const photo = storefront.representativePhotos[0]
  const query = new URLSearchParams({ from, to })
  const href = `/storefronts/${storefront.locationId}?${query.toString()}`

  const priceLabel =
    storefront.fromDailyPriceJpy != null
      ? t('fromDaily', { price: storefront.fromDailyPriceJpy.toLocaleString('en-US') })
      : storefront.fromHourlyPriceJpy != null
        ? t('fromHourly', { price: storefront.fromHourlyPriceJpy.toLocaleString('en-US') })
        : t('noPrice')

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={storefront.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="size-12 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{storefront.operatorName}</p>
          <h2 className="text-lg font-semibold leading-tight">{storefront.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="line-clamp-1">{storefront.address}</span>
          </p>
        </div>
        <ClassSummaryBadges summaries={storefront.classSummaries} />
        <p className="mt-auto text-base font-semibold text-foreground">{priceLabel}</p>
      </div>
    </Link>
  )
}
