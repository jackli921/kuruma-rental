import { PageSkeleton } from '@/vite/PageSkeleton'
import { DEFAULT_LOCALE, isLocale } from '@/vite/i18n/locale'
import { OperatorAddOnsView } from '@/vite/operator-add-ons/OperatorAddOnsView'
import { addOnsQueryOptions } from '@/vite/operator-add-ons/api'
import { useOperatorScope } from '@/vite/operator-context'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useLocale, useTranslations } from 'use-intl'

// Operator add-on management (#585). URL `/<locale>/manage/add-ons` — behind the
// `_business` guard, so only business roles reach it. Tenant scoping is server-side
// (CallerContext): an operator session auto-scopes; a cross-operator reader sees all
// tenants (read-only); a platform admin who has picked a tenant via the operator
// context picker scopes to it and may write. The `operator` search param (read via
// loaderDeps so a context switch refetches) selects the picked tenant; the loader
// prefetches that scoped list into the cache (no FOUC) and the component reads it back.
export const Route = createFileRoute('/$locale/_business/manage/add-ons')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps, params }) => {
    const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE
    return context.queryClient.ensureQueryData(addOnsQueryOptions(deps.operator, locale))
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorAddOnsError,
  component: OperatorAddOnsRoute,
})

function OperatorAddOnsRoute() {
  const t = useTranslations('business.addOns')
  const scope = useOperatorScope()
  const rawLocale = useLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const { data: addOns } = useSuspenseQuery(addOnsQueryOptions(scope.pickedOperatorId, locale))

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorAddOnsView addOns={addOns} scope={scope} />
      </div>
    </main>
  )
}

function OperatorAddOnsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.addOns')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl py-20 text-center">
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
