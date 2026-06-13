import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorSession } from '@/vite/guards'
import { OperatorFleetView } from '@/vite/operator-fleet/OperatorFleetView'
import {
  operatorFleetQueryOptions,
  vehicleClassOptionsQueryOptions,
} from '@/vite/operator-fleet/api'
import { sessionQueryOptions } from '@/vite/session'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator fleet management (#526). URL `/<locale>/manage/fleet` — behind the
// `_business` guard, so only business roles reach it; tenant scoping is
// server-side (CallerContext), the client passes no operatorId. The loader
// prefetches into the query cache (no FOUC); the component reads the same
// options via useSuspenseQuery. This foundation ships the read-only list; the
// CRUD / filters / bulk / photo slices are mounted here at integration (#526).
// The loader also prefetches the operator's vehicle-class options so the grid
// view (#561) can group by class with no "Unassigned" flash, and so the edit
// sheet's class dropdown is a warm-cache read — both behind this route's
// pendingComponent rather than each component owning its own loading state.
// Lives at `fleet/index` (not `fleet.tsx`) so the sibling `fleet/$vehicleId`
// detail route (#527) can coexist; the URL is unchanged.
export const Route = createFileRoute('/$locale/_business/manage/fleet/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(operatorFleetQueryOptions()),
      context.queryClient.ensureQueryData(vehicleClassOptionsQueryOptions()),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFleetError,
  component: OperatorFleetRoute,
})

export function OperatorFleetRoute() {
  const t = useTranslations('business.vehicles.fleet')
  const { locale } = Route.useParams()
  const { data: vehicles } = useSuspenseQuery(operatorFleetQueryOptions())
  const { data: classOptions } = useSuspenseQuery(vehicleClassOptionsQueryOptions())
  const { data: session } = useSuspenseQuery(sessionQueryOptions())

  // Bypass roles (PLATFORM_ADMIN / legacy STAFF·ADMIN — no operatorId) read the
  // fleet cross-operator for oversight but cannot write: every create/edit/bulk
  // write needs a single target tenant they don't carry, and the form has no
  // operator picker (the API 422s such a write). So the page is read-only for
  // them, mirroring classes (#583) and locations (#581).
  const canWrite = isOperatorSession(session)

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
          canWrite={canWrite}
          locale={locale}
        />
      </div>
    </main>
  )
}

function OperatorFleetError(_props: ErrorComponentProps) {
  const t = useTranslations('business.vehicles.fleet')
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
