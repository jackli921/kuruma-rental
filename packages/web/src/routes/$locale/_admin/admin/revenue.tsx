import { PageSkeleton } from '@/vite/PageSkeleton'
import { RevenueView } from '@/vite/admin/RevenueView'
import { adminRevenueQueryOptions } from '@/vite/admin/revenue/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin partner revenue tab (#462). The `_admin` parent layout already
// gates on platform-admin membership, so this only owns the data: prefetch in
// the loader, read via useSuspenseQuery, render the pure RevenueView.
export const Route = createFileRoute('/$locale/_admin/admin/revenue')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminRevenueQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: RevenueError,
  component: RevenueRoute,
})

function RevenueRoute() {
  const { data } = useSuspenseQuery(adminRevenueQueryOptions())
  return <RevenueView report={data} />
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
