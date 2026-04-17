import { ClassCatalogCard, fetchClasses } from '@/modules/classes'
import { Car } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

// Renter-facing catalog: groups the fleet by class so visitors pick a class,
// not an individual car. Owner assigns a specific car from the class at
// pickup. Matches NicoNico-style browsing.
//
// No auth required — classes come from the public /vehicle-classes endpoint.
export default async function VehicleCatalogPage() {
  const [t, classes] = await Promise.all([
    getTranslations('catalog'),
    fetchClasses({ status: 'ACTIVE' }),
  ])

  const sorted = [...classes].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-20">
            <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">{t('empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {sorted.map((vc) => (
              <ClassCatalogCard key={vc.id} vehicleClass={vc} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
