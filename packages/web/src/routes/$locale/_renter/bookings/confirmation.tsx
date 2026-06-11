import { BookingConfirmationView } from '@/vite/bookings/BookingConfirmationView'
import { bookingByIdQueryOptions } from '@/vite/bookings/api'
import { classByIdQueryOptions } from '@/vite/vehicles/classes'
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
  const { booking, vehicleClass } = Route.useLoaderData()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <BookingConfirmationView booking={booking} vehicleClass={vehicleClass} />
    </main>
  )
}
