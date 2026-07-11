import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { DEFAULT_LOCALE, isLocale } from '@/vite/i18n/locale'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorInsuranceView } from '@/vite/operator-insurance/OperatorInsuranceView'
import { insuranceOptionsQueryOptions } from '@/vite/operator-insurance/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useLocale, useTranslations } from 'use-intl'

// Operator insurance-option management (#530). URL `/<locale>/manage/insurance`
// — behind the `_business` guard, so only business roles reach it. Tenant scoping
// is server-side (CallerContext): an operator session auto-scopes; a cross-operator
// reader sees all tenants (read-only); a platform admin who has picked a tenant via
// the operator context picker scopes to it and may write. The `operator` search param
// (read via loaderDeps so a context switch refetches) selects the picked tenant; the
// loader prefetches that scoped list into the cache (no FOUC) and the component reads
// it back, while the CRUD dialogs invalidate the shared key prefix.
export const Route = createFileRoute('/$locale/_business/manage/insurance')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps, params }) => {
    const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE
    return context.queryClient.ensureQueryData(insuranceOptionsQueryOptions(deps.operator, locale))
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorInsuranceError,
  component: OperatorInsuranceRoute,
})

function OperatorInsuranceRoute() {
  const t = useTranslations('business.insurance')
  const scope = useOperatorScope()
  const rawLocale = useLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const { data: options } = useSuspenseQuery(
    insuranceOptionsQueryOptions(scope.pickedOperatorId, locale),
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorInsuranceView options={options} scope={scope} />
      </div>
    </main>
  )
}

function OperatorInsuranceError(_props: ErrorComponentProps) {
  const t = useTranslations('business.insurance')

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
