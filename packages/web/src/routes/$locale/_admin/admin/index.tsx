import { PageSkeleton } from '@/vite/PageSkeleton'
import { AdminHomeView } from '@/vite/admin/AdminHomeView'
import { adminOverviewQueryOptions } from '@/vite/admin/overview/api'
import { RouteRetryError } from '@/vite/route-error'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-owner home (#1087, epic #1075 slice 1). The `_admin` parent layout
// already gates on platform-admin membership, so this only owns the data: prefetch
// the overview in the loader, then render the pure AdminHomeView KPI grid.
export const Route = createFileRoute('/$locale/_admin/admin/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminOverviewQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: AdminHomeError,
  component: AdminHomeRoute,
})

function AdminHomeRoute() {
  const { data } = useSuspenseQuery(adminOverviewQueryOptions())
  return <AdminHomeView overview={data} />
}

function AdminHomeError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.home')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center"
    />
  )
}
