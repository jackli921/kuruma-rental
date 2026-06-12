import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorBookingDetail } from '@/vite/operator-bookings/OperatorBookingDetail'
import {
  operatorBookingDetailQueryOptions,
  operatorRowFromDetail,
} from '@/vite/operator-bookings/api'
import {
  type ErrorComponentProps,
  Link,
  createFileRoute,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'use-intl'

// Operator trip-detail page (#549). Deep-linkable (`/<locale>/manage/bookings/:id`)
// replacement for the #548 drawer — an operator can bookmark/share a reservation.
// Behind `_business`; the single read is tenant-sealed server-side (404 -> null ->
// notFound). All data comes from the API, so a hard refresh works (no list row).
// The vertical event timeline lands in the next slice; the right column + Actions
// placeholder (phase 2) are reserved there.
export const Route = createFileRoute('/$locale/_business/manage/bookings/$bookingId')({
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      operatorBookingDetailQueryOptions(params.bookingId),
    )
    if (!detail) throw notFound()
    return { detail }
  },
  pendingComponent: PageSkeleton,
  errorComponent: TripDetailError,
  component: TripDetailRoute,
})

function TripDetailRoute() {
  const t = useTranslations('bookings.operator')
  const { locale } = Route.useParams()
  const { detail } = Route.useLoaderData()
  const row = operatorRowFromDetail(detail)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/$locale/manage/bookings"
          params={{ locale }}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('title')}
        </Link>
        <div className="rounded-xl border border-border py-6">
          <OperatorBookingDetail row={row} booking={detail} locale={locale} />
        </div>
      </div>
    </main>
  )
}

function TripDetailError(_props: ErrorComponentProps) {
  const t = useTranslations('bookings.operator')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('detail.loadError')}</p>
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
