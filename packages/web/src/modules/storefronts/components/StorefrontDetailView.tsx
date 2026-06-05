import { Link } from '@/i18n/routing'
import { ArrowLeft, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { StorefrontDetailData } from '../api'
import { AvailableVehicleCard } from './AvailableVehicleCard'

interface StorefrontDetailViewProps {
  detail: StorefrontDetailData
  /** Date range to preserve on the "back to search" link. */
  from: string
  to: string
}

/**
 * Storefront drill-down (#391). Shows the store header and its available
 * vehicles for the selected range. The API already sorts vehicles by class, so
 * the grid renders same-class cars adjacently (the grouped-by-class UI, §4).
 * A known-but-full store renders the empty-state copy, not a 404.
 */
export function StorefrontDetailView({ detail, from, to }: StorefrontDetailViewProps) {
  const t = useTranslations('search')
  const { storefront, vehicles } = detail
  const backQuery = new URLSearchParams({ from, to })

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href={`/search?${backQuery.toString()}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('detail.backToSearch')}
      </Link>

      <header className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">{storefront.operatorName}</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{storefront.name}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          {storefront.address}
        </p>
      </header>

      <h2 className="mb-4 text-xl font-semibold tracking-tight">{t('detail.availableVehicles')}</h2>
      {vehicles.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{t('detail.noVehicles')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <AvailableVehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  )
}
