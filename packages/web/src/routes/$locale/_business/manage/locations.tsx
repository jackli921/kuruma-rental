import { PageSkeleton } from '@/vite/PageSkeleton'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorLocationsView } from '@/vite/operator-locations/OperatorLocationsView'
import { operatorLocationsQueryOptions } from '@/vite/operator-locations/api'
import { RouteRetryError } from '@/vite/route-error'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator locations/storefronts management (#529). URL `/<locale>/manage/locations`
// — behind the `_business` guard, so only business roles reach it. Tenant scoping
// is server-side (CallerContext): an operator session auto-scopes; a cross-operator
// reader sees all tenants (read-only); a platform admin who has picked a tenant via
// the operator context picker scopes to it and may write. The `operator` search param
// (read via loaderDeps so a context switch refetches) selects the picked tenant; the
// loader prefetches that scoped list into the cache (no FOUC) and the view reads it
// back, while the CRUD dialogs invalidate the shared key prefix.
export const Route = createFileRoute('/$locale/_business/manage/locations')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(operatorLocationsQueryOptions(deps.operator)),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorLocationsError,
  component: OperatorLocationsRoute,
})

function OperatorLocationsRoute() {
  const t = useTranslations('business.locations')
  const scope = useOperatorScope()
  const { data: locations } = useSuspenseQuery(
    operatorLocationsQueryOptions(scope.pickedOperatorId),
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorLocationsView locations={locations} scope={scope} />
      </div>
    </main>
  )
}

function OperatorLocationsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.locations')

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-7xl py-20 text-center"
      />
    </main>
  )
}
