import { ClassCatalog } from '@/vite/vehicles/ClassCatalog'
import { activeClassesQueryOptions } from '@/vite/vehicles/classes'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Public vehicle catalog (#388). The loader prefetches the active classes into
// the query cache (no FOUC); the component reads the same options via
// useSuspenseQuery so the cache is the single source and refetches propagate.
export const Route = createFileRoute('/$locale/vehicles/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(activeClassesQueryOptions()),
  component: VehicleCatalogRoute,
})

function VehicleCatalogRoute() {
  const t = useTranslations('catalog')
  const { data: classes } = useSuspenseQuery(activeClassesQueryOptions())

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>
        <ClassCatalog classes={classes} />
      </div>
    </main>
  )
}
