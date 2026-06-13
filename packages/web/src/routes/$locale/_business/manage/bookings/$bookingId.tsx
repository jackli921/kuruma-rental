import { PageSkeleton } from '@/vite/PageSkeleton'
import { isOperatorSession } from '@/vite/guards'
import { BookingActionsPanel } from '@/vite/operator-bookings/BookingActionsPanel'
import { BookingTimeline } from '@/vite/operator-bookings/BookingTimeline'
import { OperatorBookingDetail } from '@/vite/operator-bookings/OperatorBookingDetail'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
  operatorRowFromDetail,
  substitutionCandidatesQueryOptions,
} from '@/vite/operator-bookings/api'
import { sessionQueryOptions } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
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
    // Warm the timeline cache so the page renders without a second waterfall.
    // Substitution candidates are fetched per-role in the component (they are an
    // operator-only endpoint that 403s for bypass-role oversight viewers), not
    // here — a loader fetch would reject and blank the page for those roles.
    await context.queryClient.ensureQueryData(bookingEventsQueryOptions(params.bookingId))
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
  // The replacement-candidate endpoint is operator-only and only relevant to a
  // live booking, so gate the fetch on both — bypass-role viewers (no operatorId)
  // would 403, and a settled trip can't be substituted.
  const isLive = detail.status === 'CONFIRMED' || detail.status === 'ACTIVE'
  const { data: candidates = [] } = useQuery({
    ...substitutionCandidatesQueryOptions(bookingId),
    enabled: isOperatorSession(session) && isLive,
  })
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
            <BookingActionsPanel detail={detail} session={session} candidates={candidates} />
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
