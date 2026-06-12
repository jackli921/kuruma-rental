import { formatDateTime, formatJpy } from '@/lib/format'
import type { BookingEventDto } from '@/vite/operator-bookings/api'
import type {
  BookingCancelledPayload,
  StatusChangedPayload,
  VehicleSubstitutedPayload,
} from '@kuruma/shared/db/schema'
import { useTranslations } from 'use-intl'

interface BookingTimelineProps {
  readonly events: readonly BookingEventDto[]
  readonly locale: string
}

// Vertical audit-trail stepper (#549). Pure presentation (FC/IS): the route owns
// the events fetch; this renders them oldest -> newest top-to-bottom (the API
// returns createdAt asc, id asc), with a connecting line down the spine. The
// payload union is not discriminated, so each branch narrows it off event.type.
export function BookingTimeline({ events, locale }: BookingTimelineProps) {
  const t = useTranslations('bookings.operator.timeline')
  const ts = useTranslations('bookings.operator.status')

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  }

  return (
    <ol className="relative space-y-6">
      {events.map((event, index) => {
        const isLast = index === events.length - 1
        return (
          <li key={event.id} className="relative pl-6">
            {!isLast && (
              <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-border" />
            )}
            <span
              aria-hidden
              className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-primary bg-background"
            />
            <p className="font-medium">{eventLabel(event, t, ts)}</p>
            <EventDetail event={event} t={t} />
            <time className="text-xs text-muted-foreground">
              {formatDateTime(event.createdAt, locale)}
            </time>
          </li>
        )
      })}
    </ol>
  )
}

type Translate = ReturnType<typeof useTranslations>

function eventLabel(event: BookingEventDto, t: Translate, ts: Translate): string {
  switch (event.type) {
    case 'STATUS_CHANGED': {
      const p = event.payload as StatusChangedPayload
      return t('statusChanged', { from: ts(p.from), to: ts(p.to) })
    }
    case 'VEHICLE_SUBSTITUTED':
      return t('vehicleSubstituted')
    case 'BOOKING_CANCELLED':
      return t('cancelled')
    default:
      return t('created')
  }
}

function EventDetail({ event, t }: { event: BookingEventDto; t: Translate }) {
  if (event.type === 'VEHICLE_SUBSTITUTED') {
    const { reason } = event.payload as VehicleSubstitutedPayload
    if (reason) {
      return <p className="text-sm text-muted-foreground">{t('reason', { reason })}</p>
    }
  }
  if (event.type === 'BOOKING_CANCELLED') {
    const { cancellationFee } = event.payload as BookingCancelledPayload
    if (cancellationFee != null) {
      return (
        <p className="text-sm text-muted-foreground">
          {t('cancellationFee', { fee: formatJpy(cancellationFee) })}
        </p>
      )
    }
  }
  return null
}
