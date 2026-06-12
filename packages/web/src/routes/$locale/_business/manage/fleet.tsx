import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorFleetView } from '@/vite/operator-fleet/OperatorFleetView'
import { operatorFleetQueryOptions } from '@/vite/operator-fleet/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator fleet management (#526). URL `/<locale>/manage/fleet` — behind the
// `_business` guard, so only business roles reach it; tenant scoping is
// server-side (CallerContext), the client passes no operatorId. The loader
// prefetches into the query cache (no FOUC); the component reads the same
// options via useSuspenseQuery. This foundation ships the read-only list; the
// CRUD / filters / bulk / photo slices are mounted here at integration (#526).
export const Route = createFileRoute('/$locale/_business/manage/fleet')({
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorFleetQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFleetError,
  component: OperatorFleetRoute,
})

function OperatorFleetRoute() {
  const t = useTranslations('business.vehicles.fleet')
  const { locale } = Route.useParams()
  const { data: vehicles } = useSuspenseQuery(operatorFleetQueryOptions())

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFleetView vehicles={vehicles} locale={locale} />
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
