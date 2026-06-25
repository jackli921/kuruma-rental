import { formatDateTime, formatJpy } from '@/lib/format'
import type { BookingEventDto } from '@/vite/operator-bookings/api'
import { useTranslations } from 'use-intl'

interface BookingTimelineProps {
  readonly events: readonly BookingEventDto[]
  readonly locale: string
}

// Vertical audit-trail stepper (#549). Pure presentation (FC/IS): the route owns
// the events fetch; this renders them oldest -> newest top-to-bottom (the API
// returns createdAt asc, id asc), with a connecting line down the spine. The
// payload is a discriminated union (#716), so branches narrow on event.payload.type
// with no casts and an assertNever exhaustiveness guard.
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
  const { payload } = event
  switch (payload.type) {
    case 'STATUS_CHANGED':
      return t('statusChanged', { from: ts(payload.from), to: ts(payload.to) })
    case 'VEHICLE_SUBSTITUTED':
      return t('vehicleSubstituted')
    case 'VEHICLE_ASSIGNED':
      return t('vehicleAssigned')
    case 'BOOKING_CANCELLED':
      return t('cancelled')
    case 'BOOKING_CREATED':
      return t('created')
    default:
      return assertNever(payload)
  }
}

function EventDetail({ event, t }: { event: BookingEventDto; t: Translate }) {
  const { payload } = event
  if (payload.type === 'VEHICLE_SUBSTITUTED' && payload.reason) {
    return (
      <p className="text-sm text-muted-foreground">{t('reason', { reason: payload.reason })}</p>
    )
  }
  if (payload.type === 'BOOKING_CANCELLED' && payload.cancellationFee != null) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('cancellationFee', { fee: formatJpy(payload.cancellationFee) })}
      </p>
    )
  }
  return null
}

// Compile-time exhaustiveness: a new BookingEventPayload member makes eventLabel a
// type error until it is handled here (#716).
function assertNever(value: never): never {
  throw new Error(`Unhandled booking event payload: ${JSON.stringify(value)}`)
}
