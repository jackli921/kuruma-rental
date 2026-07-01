import { BookingConfirmationView } from '@/vite/bookings/BookingConfirmationView'
import { bookingByIdQueryOptions } from '@/vite/bookings/api'
import { indexThreadIdsByBooking, threadsQueryOptions } from '@/vite/messaging'
import { useSession } from '@/vite/session'
import { classByIdQueryOptions } from '@/vite/vehicles/classes'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'

interface ConfirmationSearch {
  bookingId?: string | undefined
}

function validateSearch(search: Record<string, unknown>): ConfirmationSearch {
  return { bookingId: typeof search.bookingId === 'string' ? search.bookingId : undefined }
}

// Instant-book confirmation (#511), gated by `_renter`. The wizard's final step
// navigates here with `?bookingId=` after a successful POST /bookings. A missing
// id, or a booking that resolves to null (GET /bookings/:id is IDOR-sealed -> 404
// -> null for anything the caller doesn't own, #396), renders notFound rather than
// an error boundary. The class label is fetched separately only when present.
export const Route = createFileRoute('/$locale/_renter/bookings/confirmation')({
  validateSearch,
  loaderDeps: ({ search }) => ({ bookingId: search.bookingId }),
  loader: async ({ context, deps }) => {
    if (!deps.bookingId) throw notFound()
    const booking = await context.queryClient.ensureQueryData(
      bookingByIdQueryOptions(deps.bookingId),
    )
    if (!booking) throw notFound()
    const vehicleClass = booking.classId
      ? await context.queryClient.ensureQueryData(classByIdQueryOptions(booking.classId))
      : null
    return { booking, vehicleClass }
  },
  component: BookingConfirmationRoute,
})

function BookingConfirmationRoute() {
  const { booking: initialBooking, vehicleClass } = Route.useLoaderData()
  // Re-read the booking from the query cache the loader warmed, so a successful
  // self-cancel — which invalidates ['bookings'] — re-renders this page in its
  // CANCELLED state and drops the cancel control (mirrors the operator trip-detail
  // page, #616). Loader data is a one-shot snapshot that would stay stale.
  const { data: booking } = useSuspenseQuery(bookingByIdQueryOptions(initialBooking.id))
  // CSRF for the self-cancel write; cached by the `_renter` layout, so this reads
  // instantly. `null` (signed-out edge) simply hides the cancel control.
  const { data: session } = useSession()
  // The booking's messaging thread (#1032), resolved without blocking the page —
  // a non-suspense read so a slow/failing /threads never gates the confirmation;
  // the "Message host" link simply appears once the thread list loads.
  const { data: threads } = useQuery(threadsQueryOptions())
  if (!booking) throw notFound()

  const threadId = threads ? (indexThreadIdsByBooking(threads)[booking.id] ?? null) : null

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <BookingConfirmationView
        booking={booking}
        vehicleClass={vehicleClass}
        csrfToken={session?.csrfToken ?? null}
        threadId={threadId}
      />
    </main>
  )
}
