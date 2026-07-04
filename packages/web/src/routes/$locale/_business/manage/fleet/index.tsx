import type { FleetFilterState } from '@/lib/fleet-filters'
import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorFleetView } from '@/vite/operator-fleet/OperatorFleetView'
import {
  operatorFleetQueryOptions,
  vehicleClassOptionsQueryOptions,
} from '@/vite/operator-fleet/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// #916 §5.5: the dashboard compliance banner deep-links here with
// `?expiringSoon=true` to open the fleet already narrowed to the non-compliant
// set. Accept the flag as a real boolean (in-app navigation) or the string
// `'true'` (a shared/reloaded URL); anything else opens unfiltered.
interface FleetSearch {
  expiringSoon?: boolean | undefined
}

function validateSearch(search: Record<string, unknown>): FleetSearch {
  return {
    expiringSoon: search.expiringSoon === true || search.expiringSoon === 'true' ? true : undefined,
  }
}

// Operator fleet management (#526). URL `/<locale>/manage/fleet` — behind the
// `_business` guard, so only business roles reach it. An OPERATOR_* session is
// tenant-scoped server-side (no operatorId sent); a bypass admin using the
// operator-context picker (#1264) narrows both reads to the picked operator via
// the `?operator` param, and writes/labels follow the derived scope. The loader
// prefetches into the query cache (no FOUC); the component reads the same options
// via useSuspenseQuery. The class-options prefetch lets the grid view (#561) group
// by class with no "Unassigned" flash and warms the edit sheet's dropdown — both
// behind this route's pendingComponent rather than each component owning its own
// loading state. Lives at `fleet/index` (not `fleet.tsx`) so the sibling
// `fleet/$vehicleId` detail route (#527) can coexist; the URL is unchanged.
export const Route = createFileRoute('/$locale/_business/manage/fleet/')({
  validateSearch,
  // `operator` is validated/retained on the parent `_business` route and merges
  // into this route's search at runtime; widen the type so tsc sees it (#1264).
  loaderDeps: ({ search }: { search: FleetSearch & { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(operatorFleetQueryOptions(deps.operator)),
      context.queryClient.ensureQueryData(vehicleClassOptionsQueryOptions(deps.operator)),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFleetError,
  component: OperatorFleetRoute,
})

export function OperatorFleetRoute() {
  const t = useTranslations('business.vehicles.fleet')
  const { locale } = Route.useParams()
  // The operator-context scope narrows every read/write to the picked operator
  // (or, unpicked, the tenant-scoped/all-operators aggregate) and drives the
  // write gate + all-mode labeling — mirroring classes (#583) / locations (#581).
  const scope = useOperatorScope()
  const { data: vehicles } = useSuspenseQuery(operatorFleetQueryOptions(scope.pickedOperatorId))
  const { data: classOptions } = useSuspenseQuery(
    vehicleClassOptionsQueryOptions(scope.pickedOperatorId),
  )
  const { expiringSoon } = Route.useSearch()
  const initialFilters: FleetFilterState = expiringSoon ? { expiringSoon: true } : {}

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFleetView
          vehicles={vehicles}
          classOptions={classOptions}
          scope={scope}
          locale={locale}
          initialFilters={initialFilters}
        />
      </div>
    </main>
  )
}

function OperatorFleetError(_props: ErrorComponentProps) {
  const t = useTranslations('business.vehicles.fleet')

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
