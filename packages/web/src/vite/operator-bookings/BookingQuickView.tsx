import { STATUS_DOT } from '@/lib/event-colors'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { useTranslations } from 'use-intl'

interface BookingQuickViewProps {
  readonly event: CalendarEvent
  readonly locale: string
}

// Pure presentational card body for the calendar quick-view. No Popover, no Link
// (the chip wraps it) — so it renders standalone and tests with just an IntlProvider.
export function BookingQuickView({ event, locale }: BookingQuickViewProps) {
  const t = useTranslations('business.bookings.calendar')
  const renter = event.renterName ?? event.renterEmail ?? '—'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[event.status]}`}
          aria-hidden
        />
        <span className="font-medium">{t(`sidebar.statuses.${event.status}`)}</span>
        <span className="ml-auto text-muted-foreground">{event.bookingCode}</span>
      </div>
      <div>{renter}</div>
      <div className="text-muted-foreground">{event.vehicleName ?? '—'}</div>
      <div className="text-muted-foreground">
        {formatDateTime(event.start, locale)} – {formatDateTime(event.end, locale)}
      </div>
      {event.totalPrice != null && <div className="font-medium">{formatJpy(event.totalPrice)}</div>}
      <div className="mt-1 font-medium text-primary">{t('viewFullDetails')} →</div>
    </div>
  )
}
