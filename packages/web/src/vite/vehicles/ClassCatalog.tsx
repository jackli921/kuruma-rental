import { ClassCatalogCard } from '@/vite/vehicles/ClassCatalogCard'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { Car } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface ClassCatalogProps {
  readonly classes: readonly VehicleClassData[]
}

// Presentational grid + empty state. The route owns the loader/useQuery; this
// stays a pure function of the resolved classes so it is unit-testable.
export function ClassCatalog({ classes }: ClassCatalogProps) {
  const t = useTranslations('catalog')

  if (classes.length === 0) {
    return (
      <div className="text-center py-20">
        <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {classes.map((vc) => (
        <ClassCatalogCard key={vc.id} vehicleClass={vc} />
      ))}
    </div>
  )
}
