import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { BookingOversightView } from '@/vite/admin/bookings/BookingOversightView'
import { type AdminBookingFiltersInput, adminBookingsQueryOptions } from '@/vite/admin/bookings/api'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Only keep a string search param when it's a non-empty string; status is also
// constrained to the known enum so a junk value falls back to "all" rather than
// 400-ing the loader.
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function validateSearch(search: Record<string, unknown>): AdminBookingFiltersInput {
  const status = str(search.status)
  const next: AdminBookingFiltersInput = {}
  const operatorId = str(search.operatorId)
  const bookingCode = str(search.bookingCode)
  const customer = str(search.customer)
  const cursor = str(search.cursor)
  if (operatorId) next.operatorId = operatorId
  if (bookingCode) next.bookingCode = bookingCode
  if (customer) next.customer = customer
  if (status && (BOOKING_STATUSES as readonly string[]).includes(status)) next.status = status
  if (cursor) next.cursor = cursor
  return next
}

// Platform-admin cross-operator booking oversight (#1092). The `_admin` parent
// layout already gates on platform-admin membership; this owns the data: read the
// filter search params, prefetch in the loader, render the pure
// BookingOversightView and turn its filter changes into URL navigations.
export const Route = createFileRoute('/$locale/_admin/admin/bookings')({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(adminBookingsQueryOptions(deps)),
  pendingComponent: PageSkeleton,
  errorComponent: BookingsError,
  component: BookingsRoute,
})

function BookingsRoute() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(adminBookingsQueryOptions(filters))
  return (
    <BookingOversightView
      response={data}
      filters={filters}
      onApplyFilters={(next) => navigate({ search: () => next })}
    />
  )
}

function BookingsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.bookings')
  return <RouteRetryError message={t('loadError')} retryLabel={t('retry')} />
}
