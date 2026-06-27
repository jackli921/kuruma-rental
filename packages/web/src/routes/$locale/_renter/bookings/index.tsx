import { PageSkeleton } from '@/vite/PageSkeleton'
import { MyBookingsView } from '@/vite/bookings/MyBookingsView'
import { myBookingsQueryOptions } from '@/vite/bookings/api'
import { threadsQueryOptions } from '@/vite/messaging/api'
import { indexThreadIdsByBooking } from '@/vite/messaging/booking-threads'
import { renterReviewedSubjects, reviewsForBookingQueryOptions } from '@/vite/reviews'
import { sessionQueryOptions } from '@/vite/session'
import { useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Renter "My Bookings" (#543). Gated by `_renter` (session required). The loader
// reads the caller's own id from the cached session and prefetches their bookings
// with renterId=self — a principal-identical query (vite/bookings/api): it means
// "bookings where I am the renter" for any caller, so an operator-in-renter-view
// who reaches this URL never sees tenant rows. The component reads the same options
// via useSuspenseQuery (no FOUC). Mirrors the operator route at manage/bookings.
export const Route = createFileRoute('/$locale/_renter/bookings/')({
  loader: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // The parent `_renter` guard redirects an anonymous caller before this runs;
    // re-checking keeps the type honest and is a defensive backstop.
    if (!session) {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
    await context.queryClient.ensureQueryData(myBookingsQueryOptions(session.user.id))
    return { renterId: session.user.id }
  },
  pendingComponent: PageSkeleton,
  errorComponent: MyBookingsError,
  component: MyBookingsRoute,
})

function MyBookingsRoute() {
  const t = useTranslations('bookings.list')
  const { locale } = Route.useParams()
  const { renterId } = Route.useLoaderData()
  const { data: bookings } = useSuspenseQuery(myBookingsQueryOptions(renterId))
  // Resolve each booking's conversation without blocking the list — a non-suspense
  // read so a slow/failing /threads never gates My Bookings; the per-row "Message
  // host" links simply appear once the thread list loads (#1032).
  const { data: threads } = useQuery(threadsQueryOptions())
  const threadIdByBooking = threads ? indexThreadIdsByBooking(threads) : {}

  // #1083: resolve each COMPLETED booking's reviews without blocking the list (the
  // post-trip prompt appears once its query lands). One light read per completed
  // trip — renter scale; aligned to `completed` by index.
  const completed = bookings.filter((b) => b.status === 'COMPLETED')
  const reviewQueries = useQueries({
    queries: completed.map((b) => reviewsForBookingQueryOptions(b.id)),
  })
  const reviewedSubjectsByBooking = Object.fromEntries(
    completed.flatMap((b, i) => {
      const data = reviewQueries[i]?.data
      return data ? [[b.id, renterReviewedSubjects(data)] as const] : []
    }),
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <MyBookingsView
          bookings={bookings}
          locale={locale}
          threadIdByBooking={threadIdByBooking}
          reviewedSubjectsByBooking={reviewedSubjectsByBooking}
        />
      </div>
    </main>
  )
}

function MyBookingsError(_props: ErrorComponentProps) {
  const t = useTranslations('bookings.list')
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
