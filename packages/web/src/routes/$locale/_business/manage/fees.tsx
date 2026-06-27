import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorSession } from '@/vite/guards'
import { operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { useOperatorScope } from '@/vite/operator-context'
import { OperatorFeesView } from '@/vite/operator-fees/OperatorFeesView'
import { feeSchedulesQueryOptions } from '@/vite/operator-fees/api'
import { useSession } from '@/vite/session'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
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
      context.queryClient.ensureQueryData(operatorClassesQueryOptions()),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFeesError,
  component: OperatorFeesRoute,
})

function OperatorFeesRoute() {
  const t = useTranslations('business.fees')
  const scope = useOperatorScope()
  const { data: session } = useSession()
  const { data: fees } = useSuspenseQuery(feeSchedulesQueryOptions(scope.pickedOperatorId))
  const { data: classes } = useSuspenseQuery(operatorClassesQueryOptions())

  // P1b: picker-admins are read-only on fees until slice 3 scopes the class
  // dropdown (/vehicle-classes/manage has no operatorId param yet, so a picked
  // admin would see another tenant's classes and hit a composite-FK error on
  // create). A real operator session writes under its own tenant as before, so
  // override the scope's canWrite to operator-session-only here.
  const feesScope = { ...scope, canWrite: isOperatorSession(session ?? null) }

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFeesView fees={fees} classes={classes} scope={feesScope} />
      </div>
    </main>
  )
}

function OperatorFeesError(_props: ErrorComponentProps) {
  const t = useTranslations('business.fees')
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
