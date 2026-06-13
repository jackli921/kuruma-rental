import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorSession } from '@/vite/guards'
import { VehicleDetail } from '@/vite/operator-fleet/VehicleDetail'
import { vehicleDetailQueryOptions } from '@/vite/operator-fleet/api'
import { sessionQueryOptions } from '@/vite/session'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  Link,
  createFileRoute,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'use-intl'

// Operator vehicle-detail page (#527). Deep-linkable (`/<locale>/manage/fleet/:id`)
// drill-down from the fleet list. Behind `_business`; the single read is
// tenant-sealed server-side (a foreign / missing vehicle 404s -> null ->
// notFound), so a hard refresh works without a list row. The detail comes via
// useSuspenseQuery (not loader data) so an in-page edit refreshes it through the
// shared `operator-fleet` query invalidation.
export const Route = createFileRoute('/$locale/_business/manage/fleet/$vehicleId')({
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      vehicleDetailQueryOptions(params.vehicleId),
    )
    if (!detail) throw notFound()
  },
  pendingComponent: PageSkeleton,
  errorComponent: VehicleDetailError,
  component: VehicleDetailRoute,
})

function VehicleDetailRoute() {
  const t = useTranslations('business.vehicles.detail')
  const { locale, vehicleId } = Route.useParams()
  const { data: detail } = useSuspenseQuery(vehicleDetailQueryOptions(vehicleId))
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const canWrite = isOperatorSession(session)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/$locale/manage/fleet"
          params={{ locale }}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('backToFleet')}
        </Link>
        {detail ? (
          <VehicleDetail detail={detail} locale={locale} canWrite={canWrite} />
        ) : (
          <p className="py-20 text-center text-lg text-muted-foreground">{t('notFound')}</p>
        )}
      </div>
    </main>
  )
}

function VehicleDetailError(_props: ErrorComponentProps) {
  const t = useTranslations('business.vehicles.fleet')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl py-20 text-center">
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
