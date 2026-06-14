import { PageSkeleton } from '@/vite/PageSkeleton'
import { AnomaliesPanel } from '@/vite/admin/AnomaliesPanel'
import { RevenueView } from '@/vite/admin/RevenueView'
import { paymentAnomaliesQueryOptions } from '@/vite/admin/anomalies/api'
import { adminRevenueQueryOptions } from '@/vite/admin/revenue/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// `YYYY-MM` (JST) payout-month filter (#628); an invalid value is dropped so the
// tab falls back to the all-months matrix rather than erroring.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function validateSearch(search: Record<string, unknown>): { month?: string } {
  const month =
    typeof search.month === 'string' && MONTH_RE.test(search.month) ? search.month : undefined
  return month ? { month } : {}
}

// Platform-admin partner revenue tab (#462, month filter #628). The `_admin`
// parent layout already gates on platform-admin membership, so this only owns the
// data: read the `?month` search param, prefetch in the loader, render the pure
// RevenueView and turn its picker into a URL navigation.
export const Route = createFileRoute('/$locale/_admin/admin/revenue')({
  validateSearch,
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adminRevenueQueryOptions(deps.month)),
      context.queryClient.ensureQueryData(paymentAnomaliesQueryOptions()),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: RevenueError,
  component: RevenueRoute,
})

function RevenueRoute() {
  const { locale } = Route.useParams()
  const { month } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(adminRevenueQueryOptions(month))
  const { data: anomalyData } = useSuspenseQuery(paymentAnomaliesQueryOptions())
  return (
    <>
      {/* Anomalies sit above the revenue tables: a duplicate charge to refund or a
          mismatch to investigate needs the admin's eye before the payout figures. */}
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <AnomaliesPanel anomalies={anomalyData.anomalies} locale={locale} />
      </div>
      <RevenueView
        report={data}
        onSelectMonth={(next) => navigate({ search: () => (next ? { month: next } : {}) })}
      />
    </>
  )
}

function RevenueError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.revenue')
  const router = useRouter()
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
