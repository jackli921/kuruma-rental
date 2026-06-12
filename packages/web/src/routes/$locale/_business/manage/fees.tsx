import { PageSkeleton } from '@/vite/PageSkeleton'
import { operatorClassesQueryOptions } from '@/vite/operator-classes/api'
import { OperatorFeesView } from '@/vite/operator-fees/OperatorFeesView'
import { feeSchedulesQueryOptions } from '@/vite/operator-fees/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator fee-schedule management (#530). URL `/<locale>/manage/fees` — behind
// the `_business` guard, so only business roles reach it; tenant scoping is
// server-side (CallerContext). The loader prefetches BOTH the fees and the
// operator-scoped vehicle classes (#528) — the latter feeds the per-class
// dropdown and resolves each fee's class name. The dropdown is fed ONLY the
// caller's own classes, never the public cross-operator catalog.
export const Route = createFileRoute('/$locale/_business/manage/fees')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(feeSchedulesQueryOptions()),
      context.queryClient.ensureQueryData(operatorClassesQueryOptions()),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFeesError,
  component: OperatorFeesRoute,
})

function OperatorFeesRoute() {
  const t = useTranslations('business.fees')
  const { data: fees } = useSuspenseQuery(feeSchedulesQueryOptions())
  const { data: classes } = useSuspenseQuery(operatorClassesQueryOptions())

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFeesView fees={fees} classes={classes} />
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
