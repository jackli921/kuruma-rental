import { PageSkeleton } from '@/vite/PageSkeleton'
import { useOperatorContext } from '@/vite/operator-context'
import { OperatorDashboardView } from '@/vite/operator-dashboard/OperatorDashboardView'
import { operatorOverviewQueryOptions } from '@/vite/operator-dashboard/api'
import { operatorFleetQueryOptions } from '@/vite/operator-fleet/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator landing (#524). Provider login (#521) routes here. The `_business`
// parent layout already gates on operator membership, so this only owns the
// data: prefetch in the loader, read via useSuspenseQuery, render the pure view.
// The loader also warms the fleet query so the §5.5 compliance banner (#916) can
// count expiring shaken/insurance with no second loading state.
//
// #407 slice 4: a PLATFORM_ADMIN using the operator-context picker narrows both
// reads to the picked operator. loaderDeps re-runs the loader when `?operator`
// changes; the component reads the same picked id so the loader-warmed cache
// entry and the useSuspenseQuery read share one key (no refetch, no FOUC).
// INVARIANT: the loader (deps.operator) and the component (useOperatorContext →
// the `_business` `operator` search param) MUST resolve the id from the SAME
// validated source. They agree today because the dashboard adds no own
// validateSearch and inherits `_business`'s. A dashboard-level search transform
// would split the two keys and reintroduce a wrong-tenant flash — dashboard.route
// test pins loaderDeps → the exact ensureQueryData keys to catch that.
export const Route = createFileRoute('/$locale/_business/dashboard')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(operatorOverviewQueryOptions(deps.operator)),
      context.queryClient.ensureQueryData(operatorFleetQueryOptions(deps.operator)),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorDashboardError,
  component: OperatorDashboardRoute,
})

function OperatorDashboardRoute() {
  const { locale } = Route.useParams()
  const { pickedOperatorId } = useOperatorContext()
  const { data: overview } = useSuspenseQuery(operatorOverviewQueryOptions(pickedOperatorId))
  const { data: vehicles } = useSuspenseQuery(operatorFleetQueryOptions(pickedOperatorId))
  return <OperatorDashboardView overview={overview} vehicles={vehicles} locale={locale} />
}

function OperatorDashboardError(_props: ErrorComponentProps) {
  const t = useTranslations('business.dashboard')
  const router = useRouter()
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
