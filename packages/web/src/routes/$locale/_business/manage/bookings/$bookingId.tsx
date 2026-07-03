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
import { RateRenterPanel } from '@/vite/reviews'
import { RouteRetryError } from '@/vite/route-error'
import { sessionQueryOptions } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, Link, createFileRoute, notFound } from '@tanstack/react-router'
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
  },
  pendingComponent: PageSkeleton,
  errorComponent: TripDetailError,
  component: TripDetailRoute,
})

export function TripDetailRoute() {
  const t = useTranslations('bookings.operator')
  const { locale, bookingId } = Route.useParams()
  // Read detail from the query cache (not loader data) so the panel's status /
  // substitute / cancel actions — which invalidateQueries(['operator-bookings']) on
  // success — re-render this page with the new state. Loader data only refreshes on
  // a route re-run, so reading it here would leave the panel + buttons stale after
  // an action while the timeline (a useSuspenseQuery) updated (#616). The loader
  // still warms this query + fires notFound, so there is no render waterfall.
  const { data: detail } = useSuspenseQuery(operatorBookingDetailQueryOptions(bookingId))
  const { data: events } = useSuspenseQuery(bookingEventsQueryOptions(bookingId))
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  // The replacement-candidate endpoint is operator-only and only relevant to a
  // live booking, so gate the fetch on both — bypass-role viewers (no operatorId)
  // would 403, and a settled trip can't be substituted.
  const isLive = detail?.status === 'CONFIRMED' || detail?.status === 'ACTIVE'
  const { data: candidates = [], isError: candidatesError } = useQuery({
    ...substitutionCandidatesQueryOptions(bookingId),
    enabled: isOperatorSession(session) && isLive,
  })
  // The loader already mapped a missing/foreign booking to notFound; this narrows
  // the nullable query type for the render below.
  if (!detail) throw notFound()
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
            <BookingActionsPanel
              detail={detail}
              session={session}
              candidates={candidates}
              candidatesError={candidatesError}
            />
            {/* #1084: rate the renter once the trip is COMPLETED. Operator sessions only —
                oversight viewers (PLATFORM_ADMIN, no operatorId) aren't review participants
                and the API would 403 them. */}
            {detail.status === 'COMPLETED' && session && isOperatorSession(session) ? (
              <RateRenterPanel
                bookingId={bookingId}
                bookingCode={detail.bookingCode}
                csrfToken={session.csrfToken}
              />
            ) : null}
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

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('detail.loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-3xl py-20 text-center"
      />
    </main>
  )
}
