import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { OperatorCombosView } from '@/vite/operator-combo-deals/OperatorCombosView'
import { comboDealsQueryOptions } from '@/vite/operator-combo-deals/api'
import { useOperatorScope } from '@/vite/operator-context'
import { operatorLocationsQueryOptions } from '@/vite/operator-locations/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator combo-deals management (#464 slice 7). URL `/<locale>/manage/combo-deals`
// — behind the `_business` guard, so only business roles reach it; tenant scoping is
// server-side (CallerContext). The loader prefetches THREE reads scoped to the
// `operator` search param (read via loaderDeps so a context switch refetches): the
// combo deals, the operator's vehicle classes (#528), AND its locations (#529). The
// classes/locations feed the create/edit dropdowns and resolve each deal's class +
// location name. Unflagged (Q2) — no feature-flag redirect.
export const Route = createFileRoute('/$locale/_business/manage/combo-deals')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(comboDealsQueryOptions(deps.operator)),
      context.queryClient.ensureQueryData(operatorClassesQueryOptions({}, deps.operator)),
      context.queryClient.ensureQueryData(operatorLocationsQueryOptions(deps.operator)),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorCombosError,
  component: OperatorCombosRoute,
})

export function OperatorCombosRoute() {
  const t = useTranslations('business.comboDeals')
  const scope = useOperatorScope()
  const { data: deals } = useSuspenseQuery(comboDealsQueryOptions(scope.pickedOperatorId))
  const { data: classes } = useSuspenseQuery(
    operatorClassesQueryOptions({}, scope.pickedOperatorId),
  )
  const { data: locations } = useSuspenseQuery(
    operatorLocationsQueryOptions(scope.pickedOperatorId),
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorCombosView deals={deals} classes={classes} locations={locations} scope={scope} />
      </div>
    </main>
  )
}

function OperatorCombosError(_props: ErrorComponentProps) {
  const t = useTranslations('business.comboDeals')

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-4xl py-20 text-center"
      />
    </main>
  )
}
