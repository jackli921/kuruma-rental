import { PageSkeleton } from '@/vite/PageSkeleton'
import { BookingActionsPanel } from '@/vite/operator-bookings/BookingActionsPanel'
import { BookingTimeline } from '@/vite/operator-bookings/BookingTimeline'
import { OperatorBookingDetail } from '@/vite/operator-bookings/OperatorBookingDetail'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
  operatorRowFromDetail,
} from '@/vite/operator-bookings/api'
import { operatorFleetQueryOptions } from '@/vite/operator-fleet/api'
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

// Operator trip-detail page (#549). Deep-linkable (`/<locale>/manage/bookings/:id`)
// replacement for the #548 drawer — an operator can bookmark/share a reservation.
// Behind `_business`; the single read is tenant-sealed server-side (404 -> null ->
// notFound). All data comes from the API, so a hard refresh works (no list row).
// Two-column layout: booking detail + the Actions panel (#610 vehicle substitution)
// on the left, the vertical event timeline right.
export const Route = createFileRoute('/$locale/_business/manage/bookings/$bookingId')({
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      operatorBookingDetailQueryOptions(params.bookingId),
    )
    if (!detail) throw notFound()
    // Warm the timeline + replacement-candidate caches so the page renders without
    // a second waterfall. The fleet read backs the substitution dialog's picker.
    await Promise.all([
      context.queryClient.ensureQueryData(bookingEventsQueryOptions(params.bookingId)),
      context.queryClient.ensureQueryData(operatorFleetQueryOptions()),
    ])
    return { detail }
  },
  pendingComponent: PageSkeleton,
  errorComponent: TripDetailError,
  component: TripDetailRoute,
})

function TripDetailRoute() {
  const t = useTranslations('bookings.operator')
  const { locale, bookingId } = Route.useParams()
  const { detail } = Route.useLoaderData()
  const { data: events } = useSuspenseQuery(bookingEventsQueryOptions(bookingId))
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { data: fleet } = useSuspenseQuery(operatorFleetQueryOptions())
  const row = operatorRowFromDetail(detail)

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/$locale/manage/bookings"
          params={{ locale }}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('title')}
        </Link>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <section className="space-y-6">
            <div className="rounded-xl border border-border py-6">
              <OperatorBookingDetail row={row} booking={detail} locale={locale} />
            </div>
            <BookingActionsPanel detail={detail} session={session} fleet={fleet} />
          </section>
          <aside className="rounded-xl border border-border px-4 py-6">
            <h2 className="mb-6 text-sm font-semibold">{t('timeline.heading')}</h2>
            <BookingTimeline events={events} locale={locale} />
          </aside>
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
