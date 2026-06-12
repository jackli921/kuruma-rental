import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { AddLocationDialog } from '@/vite/operator-locations/AddLocationDialog'
import { OperatorLocationsView } from '@/vite/operator-locations/OperatorLocationsView'
import { operatorLocationsQueryOptions } from '@/vite/operator-locations/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

// Operator locations/storefronts management (#529). URL `/<locale>/manage/locations`
// — behind the `_business` guard, so only business roles reach it; tenant scoping
// is server-side (CallerContext), the client passes no operatorId. The loader
// prefetches into the query cache (no FOUC); the component reads the same options
// via useSuspenseQuery. This slice ships the read-only list; create / edit /
// archive land in follow-up slices and are mounted here.
export const Route = createFileRoute('/$locale/_business/manage/locations')({
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorLocationsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorLocationsError,
  component: OperatorLocationsRoute,
})

function OperatorLocationsRoute() {
  const t = useTranslations('business.locations')
  const { data: locations } = useSuspenseQuery(operatorLocationsQueryOptions())
  const [addOpen, setAddOpen] = useState(false)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus className="size-4" />
            {t('addLocation')}
          </Button>
        </header>
        <OperatorLocationsView locations={locations} />
        <AddLocationDialog open={addOpen} onOpenChange={setAddOpen} />
      </div>
    </main>
  )
}

function OperatorLocationsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.locations')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
