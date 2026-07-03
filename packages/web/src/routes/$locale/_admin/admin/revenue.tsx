import { PageSkeleton } from '@/vite/PageSkeleton'
import { AnomaliesPanel } from '@/vite/admin/AnomaliesPanel'
import { RevenueView } from '@/vite/admin/RevenueView'
import { paymentAnomaliesQueryOptions } from '@/vite/admin/anomalies/api'
import { adminRevenueQueryOptions } from '@/vite/admin/revenue/api'
import { RouteRetryError } from '@/vite/route-error'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
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
  // Revenue is the page's primary data and blocks render. Anomalies are secondary
  // oversight (#744), prefetched fire-and-forget so a failing or absent endpoint
  // can never fault the loader and blank the payout report.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(paymentAnomaliesQueryOptions())
    return context.queryClient.ensureQueryData(adminRevenueQueryOptions(deps.month))
  },
  pendingComponent: PageSkeleton,
  errorComponent: RevenueError,
  component: RevenueRoute,
})

function RevenueRoute() {
  const { locale } = Route.useParams()
  const { month } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(adminRevenueQueryOptions(month))
  // Non-blocking: while the anomalies read is pending or if it fails, the panel is
  // simply omitted and the revenue report still renders (the panel is supplementary).
  const { data: anomalyData } = useQuery(paymentAnomaliesQueryOptions())
  return (
    <>
      {/* Anomalies sit above the revenue tables: a duplicate charge to refund or a
          mismatch to investigate needs the admin's eye before the payout figures. */}
      {anomalyData ? (
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
          <AnomaliesPanel anomalies={anomalyData.anomalies} locale={locale} />
        </div>
      ) : null}
      <RevenueView
        report={data}
        onSelectMonth={(next) => navigate({ search: () => (next ? { month: next } : {}) })}
      />
    </>
  )
}

function RevenueError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.revenue')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center"
    />
  )
}
