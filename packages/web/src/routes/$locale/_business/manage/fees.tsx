import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorFeesView } from '@/vite/operator-fees/OperatorFeesView'
import { feeSchedulesQueryOptions } from '@/vite/operator-fees/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator fee-schedule management (#530). URL `/<locale>/manage/fees` — behind
// the `_business` guard, so only business roles reach it; tenant scoping is
// server-side (CallerContext). The loader prefetches BOTH the fees (scoped to the
// `operator` search param, read via loaderDeps so a context switch refetches) and
// the operator-scoped vehicle classes (#528) — the latter feeds the per-class
// dropdown and resolves each fee's class name. The dropdown is fed ONLY the
// caller's own classes, never the public cross-operator catalog.
export const Route = createFileRoute('/$locale/_business/manage/fees')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(feeSchedulesQueryOptions(deps.operator)),
      context.queryClient.ensureQueryData(operatorClassesQueryOptions({}, deps.operator)),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFeesError,
  component: OperatorFeesRoute,
})

// Exported so a route-level test can pin the P1b read-only override (the
// `feesScope` junction below); the file route mounts it as the component.
export function OperatorFeesRoute() {
  const t = useTranslations('business.fees')
  const scope = useOperatorScope()
  const { data: fees } = useSuspenseQuery(feeSchedulesQueryOptions(scope.pickedOperatorId))
  const { data: classes } = useSuspenseQuery(
    operatorClassesQueryOptions({}, scope.pickedOperatorId),
  )

  // #1442: writes are picker-aware now. `scope.canWrite` is `canWriteAsOperator`
  // (a real operator, OR a picker admin who has chosen an operator), and the
  // create/update/archive calls bind to `scope.pickedOperatorId` end-to-end.
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFeesView fees={fees} classes={classes} scope={scope} />
      </div>
    </main>
  )
}

function OperatorFeesError(_props: ErrorComponentProps) {
  const t = useTranslations('business.fees')

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
