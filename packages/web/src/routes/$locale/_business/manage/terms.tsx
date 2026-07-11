import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorTermsView } from '@/vite/operator-terms/OperatorTermsView'
import { operatorTermsQueryOptions } from '@/vite/operator-terms/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator rental-terms authoring (#877 follow-up). URL `/<locale>/manage/terms`
// — behind the `_business` guard, so only business roles reach it. Gated by the
// OPERATOR_TERMS flag (dark until Slice B): beforeLoad reads the runtime override
// (a dashboard toggle opens the route live) and redirects to the dashboard when it
// is OFF, so a direct URL can't reach an unreleased surface even though the nav
// entry is already hidden. Tenant scoping mirrors insurance: the `operator` search
// param (read via loaderDeps so a context switch refetches) selects the picked
// tenant; the loader prefetches that scoped list (no FOUC) and the component reads
// it back, while the CRUD dialogs invalidate the shared key prefix.
export const Route = createFileRoute('/$locale/_business/manage/terms')({
  beforeLoad: async ({ context, params }) => {
    const overrides = await context.queryClient.ensureQueryData(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'OPERATOR_TERMS')) {
      throw redirect({ to: '/$locale/dashboard', params: { locale: params.locale } })
    }
  },
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(operatorTermsQueryOptions(deps.operator)),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorTermsError,
  component: OperatorTermsRoute,
})

function OperatorTermsRoute() {
  const t = useTranslations('business.terms')
  const scope = useOperatorScope()
  const { data: versions } = useSuspenseQuery(operatorTermsQueryOptions(scope.pickedOperatorId))

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorTermsView versions={versions} scope={scope} />
      </div>
    </main>
  )
}

function OperatorTermsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.terms')

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
