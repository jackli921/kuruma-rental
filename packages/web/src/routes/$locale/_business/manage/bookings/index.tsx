import { PageSkeleton } from '@/vite/PageSkeleton'
import { BookingsCalendar } from '@/vite/operator-bookings/BookingsCalendar'
import { CalendarSidebar } from '@/vite/operator-bookings/CalendarSidebar'
import { operatorCalendarQueryOptions } from '@/vite/operator-bookings/api'
import {
  type CalendarView,
  calendarRange,
  fleetToResources,
  formatCalendarDate,
  parseCalendarDate,
  parseCalendarView,
  toCalendarEvents,
} from '@/vite/operator-bookings/calendar-events'
import { useCalendarFilters } from '@/vite/operator-bookings/useCalendarFilters'
import { operatorFleetQueryOptions } from '@/vite/operator-fleet/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useTranslations } from 'use-intl'

interface BookingsCalendarSearch {
  view?: CalendarView | undefined
  date?: string | undefined
}

const DEFAULT_VIEW: CalendarView = 'week'

// Operator booking *calendar* (#525). URL `/<locale>/manage/bookings`, behind the
// `_business` guard; tenant scoping is server-side (CallerContext), so the client
// passes no operatorId. The view + anchor day live in the URL (`?view=&date=`) so
// a calendar position is shareable and survives reload. Events bind to vehicle
// columns (day view) by their assigned-vehicle id; clicking one opens the existing
// trip-detail page (#549). The renter owns `/<locale>/bookings` (#511).
export const Route = createFileRoute('/$locale/_business/manage/bookings/')({
  // Search params are optional so links to the calendar need no search (the
  // component/loader default to this week, today). When present, normalize them to
  // a known view and a canonical local day so the URL stays clean and the
  // loader/component agree on the fetched range.
  validateSearch: (search: Record<string, unknown>): BookingsCalendarSearch => ({
    view: typeof search.view === 'string' ? parseCalendarView(search.view) : undefined,
    date:
      typeof search.date === 'string'
        ? formatCalendarDate(parseCalendarDate(search.date))
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ view: search.view ?? DEFAULT_VIEW, date: search.date }),
  loader: ({ context, deps }) => {
    const { from, to } = calendarRange(deps.view, parseCalendarDate(deps.date))
    return Promise.all([
      context.queryClient.ensureQueryData(operatorCalendarQueryOptions(from, to)),
      context.queryClient.ensureQueryData(operatorFleetQueryOptions()),
    ])
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorBookingsError,
  component: OperatorBookingsRoute,
})

function OperatorBookingsRoute() {
  const t = useTranslations('bookings.operator')
  const { locale } = Route.useParams()
  const { view: viewParam, date } = Route.useSearch()
  const navigate = Route.useNavigate()

  const view = viewParam ?? DEFAULT_VIEW
  const anchorDate = useMemo(() => parseCalendarDate(date), [date])
  const { from, to } = calendarRange(view, anchorDate)
  const { data: bookings } = useSuspenseQuery(operatorCalendarQueryOptions(from, to))
  const { data: fleet } = useSuspenseQuery(operatorFleetQueryOptions())

  const events = useMemo(() => toCalendarEvents(bookings), [bookings])
  const resources = useMemo(() => fleetToResources(fleet), [fleet])

  const vehicleIds = useMemo(() => fleet.map((v) => v.id), [fleet])
  const filters = useCalendarFilters(vehicleIds)
  const visibleEvents = useMemo(() => filters.filterEvents(events), [filters, events])
  const visibleResources = useMemo(() => filters.filterResources(resources), [filters, resources])

  const handleViewChange = useCallback(
    (next: CalendarView) => {
      navigate({ search: (prev) => ({ ...prev, view: next }) })
    },
    [navigate],
  )

  const handleDateChange = useCallback(
    (next: Date) => {
      navigate({ search: (prev) => ({ ...prev, date: formatCalendarDate(next) }) })
    },
    [navigate],
  )

  const handleSelectEvent = useCallback(
    (bookingId: string) => {
      navigate({ to: '/$locale/manage/bookings/$bookingId', params: { locale, bookingId } })
    },
    [navigate, locale],
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <div className="flex gap-6">
          <CalendarSidebar vehicles={fleet} filters={filters} />
          <div className="min-w-0 flex-1">
            <BookingsCalendar
              events={visibleEvents}
              resources={visibleResources}
              view={view}
              date={anchorDate}
              locale={locale}
              onViewChange={handleViewChange}
              onDateChange={handleDateChange}
              onSelectEvent={handleSelectEvent}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function OperatorBookingsError(_props: ErrorComponentProps) {
  const t = useTranslations('bookings.operator')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
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
