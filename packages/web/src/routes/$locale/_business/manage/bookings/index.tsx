import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/vite/PageSkeleton'
import {
  isOperatorBlocksEnabled,
  isOperatorManualBookingEnabled,
  isVisibleToViewer,
} from '@/vite/config'
import { isOperatorSession } from '@/vite/guards'
import {
  BlockDetailDialog,
  BlockLegend,
  BookingsCalendar,
  CalendarSidebar,
  FleetTimeline,
  ManualBookingDialog,
  ScheduleBlockDialog,
} from '@/vite/operator-bookings'
import {
  operatorCalendarBlocksQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
} from '@/vite/operator-bookings/api'
import {
  type BlockCalendarEvent,
  type CalendarItem,
  type CalendarView,
  blocksToCalendarEvents,
  calendarRange,
  fleetToResources,
  formatCalendarDate,
  parseCalendarDate,
  parseCalendarView,
  toCalendarEvents,
} from '@/vite/operator-bookings/calendar-events'
import { markBookingsSeen } from '@/vite/operator-bookings/new-bookings'
import { useCalendarFilters } from '@/vite/operator-bookings/useCalendarFilters'
import { operatorLocationsQueryOptions } from '@/vite/operator-locations/api'
import { useSession } from '@/vite/session'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'

interface BookingsCalendarSearch {
  view?: CalendarView | undefined
  date?: string | undefined
}

const DEFAULT_VIEW: CalendarView = 'timeline'

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
      context.queryClient.ensureQueryData(operatorCalendarVehiclesQueryOptions()),
    ])
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorBookingsError,
  component: OperatorBookingsRoute,
})

export function OperatorBookingsRoute() {
  const t = useTranslations('bookings.operator')
  const { locale } = Route.useParams()
  const { view: viewParam, date } = Route.useSearch()
  const navigate = Route.useNavigate()

  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  // The clicked slot's range (null when opened from the header button), threaded to
  // the dialog so a slot-click prefills its pickup/return times.
  const [slotRange, setSlotRange] = useState<{ start: Date; end: Date } | null>(null)

  // Operator-only write affordance: a manual booking needs a single target tenant,
  // which only a tenant-scoped operator session supplies (bypass roles read
  // cross-tenant and get a view-only calendar). The API re-enforces this (#589 §4.3).
  // Manual/walk-in booking is a post-MVP add-on (#589): gated behind the feature
  // flag AND the operator-session permission. OFF in the beta demo (flag unset).
  const canManualBook = isOperatorManualBookingEnabled() && isOperatorSession(session ?? null)

  // #1101 scheduled blocks. Visibility (read + the detail dialog) follows the
  // beta gate with the platform-admin preview bypass; management (schedule + delete)
  // additionally requires a tenant-scoped operator session — the write API admits a
  // platform admin (operatorId derived from the vehicle), so this affordance gate is
  // what keeps an admin preview read-only. Mirrors `canManualBook`.
  const canViewBlocks = isVisibleToViewer(isOperatorBlocksEnabled(), session?.user.role)
  const canManageBlocks = canViewBlocks && isOperatorSession(session ?? null)

  // Block dialogs: a schedule (create) form and a click-to-view detail. The schedule
  // slot prefill carries the clicked vehicle + range; the detail dialog is keyed on
  // the selected block.
  const [scheduleBlockOpen, setScheduleBlockOpen] = useState(false)
  const [blockSlotRange, setBlockSlotRange] = useState<{ start: Date; end: Date } | null>(null)
  const [blockSlotVehicleId, setBlockSlotVehicleId] = useState<string | undefined>(undefined)
  const [selectedBlock, setSelectedBlock] = useState<BlockCalendarEvent | null>(null)

  // The dialog's pickup/return store list — fetched for operators (the only role
  // that can manual-book), so it's ready the moment they open the dialog and a
  // read-only viewer never pays for it.
  const { data: locationRows } = useQuery({
    ...operatorLocationsQueryOptions(),
    enabled: canManualBook,
  })

  // #611: opening the orders list is "seeing" the new orders — clear the nav
  // red-dot badge (advance lastSeenAt to now) on every mount of this route.
  useEffect(() => {
    markBookingsSeen(queryClient)
  }, [queryClient])

  const view = viewParam ?? DEFAULT_VIEW
  const anchorDate = useMemo(() => parseCalendarDate(date), [date])
  const { from, to } = calendarRange(view, anchorDate)
  const { data: bookings } = useSuspenseQuery(operatorCalendarQueryOptions(from, to))
  const { data: vehicles } = useSuspenseQuery(operatorCalendarVehiclesQueryOptions())

  // Blocks are an additive layer (not in the suspense loader): a non-suspense query
  // that degrades to empty on error/disabled, so a blocks-read failure never blanks
  // the whole calendar (the coupling that broke the portal when it read fleet-overview).
  const { data: blocks } = useQuery({
    ...operatorCalendarBlocksQueryOptions(from, to),
    enabled: canViewBlocks,
  })

  const events = useMemo(() => toCalendarEvents(bookings), [bookings])
  const blockEvents = useMemo(
    () => (canViewBlocks ? blocksToCalendarEvents(blocks ?? []) : []),
    [canViewBlocks, blocks],
  )
  // One union list across the vehicle axis: bookings (status-colored) + block bands.
  const items = useMemo<CalendarItem[]>(() => [...events, ...blockEvents], [events, blockEvents])
  const resources = useMemo(() => fleetToResources(vehicles), [vehicles])
  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles])
  const manualBookingLocations = useMemo(
    () => (locationRows ?? []).map((l) => ({ id: l.id, name: l.name })),
    [locationRows],
  )

  const vehicleIds = useMemo(() => vehicles.map((v) => v.id), [vehicles])
  const filters = useCalendarFilters(vehicleIds)
  const visibleEvents = useMemo(() => filters.filterEvents(items), [filters, items])
  const visibleResources = useMemo(() => filters.filterResources(resources), [filters, resources])

  // The timeline renders fleet ROWS from the raw booking rows (not rbc events), so
  // it applies the same sidebar filters here: drop status-hidden bookings and those
  // on a hidden vehicle, but keep class-only floats (null vehicle → Unassigned row)
  // whenever their status is checked.
  const timelineRows = useMemo(
    () =>
      bookings.filter(
        (b) =>
          filters.isStatusChecked(b.status) &&
          (b.vehicleId == null || filters.isVehicleChecked(b.vehicleId)),
      ),
    [bookings, filters],
  )
  const timelineVehicles = useMemo(
    () => vehicles.filter((v) => filters.isVehicleChecked(v.id)),
    [vehicles, filters],
  )

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

  // The timeline emits a bare booking id; the calendar emits a CalendarItem it must
  // dispatch by type. Share one navigate-to-booking so both land on the same detail.
  const navigateToBooking = useCallback(
    (bookingId: string) => {
      navigate({
        to: '/$locale/manage/bookings/$bookingId',
        params: { locale, bookingId },
      })
    },
    [navigate, locale],
  )

  const handleSelectEvent = useCallback(
    (item: CalendarItem) => {
      // #1101: dispatch by the discriminant. A booking navigates to its detail page;
      // a block opens the block-detail dialog (view + delete).
      if (item.type === 'booking') {
        navigateToBooking(item.id)
      } else {
        setSelectedBlock(item)
      }
    },
    [navigateToBooking],
  )

  // Both the header button and a calendar slot-click open the dialog; a slot also
  // prefills the pickup/return range (the button opens an empty range).
  const handleOpenManualBooking = useCallback((range?: { start: Date; end: Date }) => {
    setSlotRange(range ?? null)
    setBookingDialogOpen(true)
  }, [])

  // The header button opens the schedule dialog with no prefill (vehicle defaults to
  // the first car, empty range).
  const handleOpenScheduleBlock = useCallback(() => {
    setBlockSlotRange(null)
    setBlockSlotVehicleId(undefined)
    setScheduleBlockOpen(true)
  }, [])

  // Slot-select precedence (one gesture, two possible dialogs): manual-booking keeps
  // the empty-slot drag when enabled (zero regression); otherwise a block-manager's
  // slot prefills the schedule dialog with the clicked vehicle + range. Read-only
  // viewers get neither (onSelectSlot omitted below), keeping the calendar view-only.
  const handleSelectSlot = useCallback(
    (range: { start: Date; end: Date; resourceId?: string }) => {
      if (canManualBook) {
        handleOpenManualBooking({ start: range.start, end: range.end })
      } else if (canManageBlocks) {
        setBlockSlotRange({ start: range.start, end: range.end })
        setBlockSlotVehicleId(range.resourceId)
        setScheduleBlockOpen(true)
      }
    },
    [canManualBook, canManageBlocks, handleOpenManualBooking],
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex gap-2">
            {canManageBlocks && (
              <Button type="button" variant="outline" onClick={handleOpenScheduleBlock}>
                {t('blocks.scheduleAction')}
              </Button>
            )}
            {canManualBook && (
              <Button type="button" onClick={() => handleOpenManualBooking()}>
                {t('newBooking.action')}
              </Button>
            )}
          </div>
        </header>
        <div className="flex gap-6">
          <CalendarSidebar vehicles={vehicles} filters={filters} />
          <div className="min-w-0 flex-1">
            {view === 'timeline' ? (
              <FleetTimeline
                rows={timelineRows}
                vehicles={timelineVehicles}
                date={anchorDate}
                locale={locale}
                onViewChange={handleViewChange}
                onDateChange={handleDateChange}
                onSelectEvent={navigateToBooking}
              />
            ) : (
              <>
                {canViewBlocks && <BlockLegend />}
                <BookingsCalendar
                  events={visibleEvents}
                  resources={visibleResources}
                  view={view}
                  date={anchorDate}
                  locale={locale}
                  onViewChange={handleViewChange}
                  onDateChange={handleDateChange}
                  onSelectEvent={handleSelectEvent}
                  onSelectSlot={canManualBook || canManageBlocks ? handleSelectSlot : undefined}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {canManualBook && (
        <ManualBookingDialog
          open={bookingDialogOpen}
          onOpenChange={setBookingDialogOpen}
          vehicles={vehicles}
          locations={manualBookingLocations}
          csrfToken={session?.csrfToken ?? ''}
          initialRange={slotRange ?? undefined}
        />
      )}
      {canManageBlocks && (
        <ScheduleBlockDialog
          open={scheduleBlockOpen}
          onOpenChange={setScheduleBlockOpen}
          vehicles={vehicles}
          csrfToken={session?.csrfToken ?? ''}
          initialVehicleId={blockSlotVehicleId}
          initialRange={blockSlotRange ?? undefined}
        />
      )}
      {canViewBlocks && (
        <BlockDetailDialog
          key={selectedBlock?.id ?? 'closed'}
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
          vehicleName={selectedBlock ? (vehiclesById.get(selectedBlock.resourceId) ?? null) : null}
          canManage={canManageBlocks}
          csrfToken={session?.csrfToken ?? ''}
          locale={locale}
        />
      )}
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
