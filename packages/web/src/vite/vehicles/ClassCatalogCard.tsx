import type { VehicleClassData } from '@/vite/vehicles/classes'
import { Link } from '@tanstack/react-router'
import { Briefcase, Car, Settings2, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface ClassCatalogCardProps {
  readonly vehicleClass: VehicleClassData
}

export function ClassCatalogCard({ vehicleClass }: ClassCatalogCardProps) {
  const t = useTranslations('catalog')
  const tAcriss = useTranslations('acriss')
  const tSize = useTranslations('luggageSize')
  const locale = useLocale()

  const photo = vehicleClass.photos[0]
  const transmissionLabel = vehicleClass.transmission === 'AUTO' ? t('auto') : t('manual')
  // Locale-correct ACRISS label, falling back to the raw code when it is outside
  // the 8-key dictionary so an off-dictionary code never crashes (#388).
  const acrissCode = vehicleClass.acrissCode
  const acrissLabel = acrissCode
    ? tAcriss.has(acrissCode)
      ? tAcriss(acrissCode)
      : acrissCode
    : null

  return (
    <Link
      to="/$locale/vehicles/classes/$slug"
      params={{ locale, slug: vehicleClass.slug }}
      className="group rounded-xl overflow-hidden bg-card border border-border shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {photo ? (
          <img
            src={photo}
            alt={vehicleClass.name}
            // 4:3 intrinsic hint lets the browser reserve the box before load (#846);
            // h-full/w-full still drive the rendered size inside the aspect wrapper.
            width={400}
            height={300}
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
          <span className="flex items-center gap-1.5">
            <Briefcase className="size-4" />
            {t('luggage', { count: vehicleClass.luggageCapacity })}
            <span className="text-muted-foreground/80"> · {tSize(vehicleClass.luggageSize)}</span>
          </span>
        </div>
      </div>
    </Link>
  )
}
