import { buttonVariants } from '@/components/ui/button'
import { formatDateTime, formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MyBookingRow } from '@/vite/bookings/api'
import { MessageHostLink } from '@/vite/messaging/MessageHostLink'
import { Link } from '@tanstack/react-router'
import { CalendarX } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface MyBookingsViewProps {
  readonly bookings: readonly MyBookingRow[]
  readonly locale: string
  /** bookingId -> threadId (#1032); a row links to its conversation when present. */
  readonly threadIdByBooking: Readonly<Record<string, string>>
}

// Presentational list + empty state for the renter's own bookings (#543). The
// route owns the loader/useSuspenseQuery and the renterId; this stays a pure
// function of the resolved rows so it is unit-testable (FC/IS — the shell does
// I/O, this renders). Each card links to the booking's confirmation/detail page.
export function MyBookingsView({ bookings, locale, threadIdByBooking }: MyBookingsViewProps) {
  const t = useTranslations('bookings.list')

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20 text-center">
        <CalendarX className="mb-4 size-12 text-muted-foreground/30" />
        <p className="mb-6 text-lg text-muted-foreground">{t('empty')}</p>
        <Link
          to="/$locale/search"
          params={{ locale }}
          className={cn(buttonVariants({ size: 'lg' }))}
        >
          {t('browseCars')}
        </Link>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {bookings.map((booking) => {
        const threadId = threadIdByBooking[booking.id]
        return (
          <li
            key={booking.id}
            className="flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/40"
          >
            <Link
              to="/$locale/bookings/confirmation"
              params={{ locale }}
              search={{ bookingId: booking.id }}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-medium">{booking.bookingCode}</span>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {t(booking.status.toLowerCase())}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">{booking.vehicleName ?? '—'}</span>
                <span className="text-sm whitespace-nowrap text-muted-foreground">
                  {`${formatDateTime(booking.startAt, locale)} – ${formatDateTime(booking.endAt, locale)}`}
                </span>
              </div>
              <span className="text-right text-lg font-semibold tabular-nums">
                {booking.totalPrice == null ? '—' : formatJpy(booking.totalPrice)}
              </span>
            </Link>
            {threadId ? (
              <MessageHostLink threadId={threadId} locale={locale} className="self-start" />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
