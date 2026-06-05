import { Link } from '@/i18n/routing'
import { Car, Settings2, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { VehicleClassData } from '../api'

interface ClassCatalogCardProps {
  vehicleClass: VehicleClassData
}

export function ClassCatalogCard({ vehicleClass }: ClassCatalogCardProps) {
  const t = useTranslations('catalog')
  const tAcriss = useTranslations('acriss')

  const photo = vehicleClass.photos[0]
  const transmissionLabel = vehicleClass.transmission === 'AUTO' ? t('auto') : t('manual')
  // Locale-correct ACRISS label, falling back to the raw code when it is
  // outside the 8-key dictionary so an off-dictionary code never crashes (#388).
  const acrissCode = vehicleClass.acrissCode
  const acrissLabel = acrissCode
    ? tAcriss.has(acrissCode)
      ? tAcriss(acrissCode)
      : acrissCode
    : null

  return (
    <Link
      href={`/vehicles/classes/${vehicleClass.slug}`}
      className="group rounded-xl overflow-hidden bg-card border border-border shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={vehicleClass.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="size-12 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{vehicleClass.name}</h2>
          {acrissLabel && (
            <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {acrissLabel}
            </span>
          )}
        </div>
        {vehicleClass.description && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {vehicleClass.description}
          </p>
        )}
        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {t('seats', { count: vehicleClass.seats })}
          </span>
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-4" />
            {transmissionLabel}
          </span>
        </div>
      </div>
    </Link>
  )
}
