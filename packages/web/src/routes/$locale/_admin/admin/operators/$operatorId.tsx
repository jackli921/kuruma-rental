import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorSummaryView, operatorSummaryQueryOptions } from '@/vite/admin/operators'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'use-intl'

// Platform-admin per-operator summary (#1120). Deep-linkable drill-down from the
// operator directory. The `_admin` layout already gates on platform-admin
// membership; the single read is platform-only server-side (403 below admin, 404
// for an unknown id → errorComponent), so a hard refresh works without a list row.
export const Route = createFileRoute('/$locale/_admin/admin/operators/$operatorId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(operatorSummaryQueryOptions(params.operatorId)),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorSummaryError,
  component: OperatorSummaryRoute,
})

function OperatorSummaryRoute() {
  const { locale, operatorId } = Route.useParams()
  const { data: summary } = useSuspenseQuery(operatorSummaryQueryOptions(operatorId))
  const t = useTranslations('admin.operators.summary')

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/$locale/admin/operators"
          params={{ locale }}
          className="mb-6 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('back')}
        </Link>
        <OperatorSummaryView summary={summary} locale={locale} />
      </div>
    </main>
  )
}

function OperatorSummaryError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.operators.summary')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
