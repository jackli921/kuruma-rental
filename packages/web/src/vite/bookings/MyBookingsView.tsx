import { buttonVariants } from '@/components/ui/button'
import { formatDateTime, formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MyBookingRow } from '@/vite/bookings/api'
import { MessageHostLink } from '@/vite/messaging'
import { ReviewPrompt } from '@/vite/reviews'
import type { ReviewSubject } from '@kuruma/shared/enums'
import { Link } from '@tanstack/react-router'
import { CalendarX } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface MyBookingsViewProps {
  readonly bookings: readonly MyBookingRow[]
  readonly locale: string
  /** bookingId -> threadId (#1032); a row links to its conversation when present. */
  readonly threadIdByBooking: Readonly<Record<string, string>>
  /** #1083: bookingId -> the renter's already-reviewed subjects for a COMPLETED
   *  booking. A key's presence means the review state has loaded; absent => not yet
   *  resolved (the post-trip prompt stays hidden until then). */
  readonly reviewedSubjectsByBooking?: Readonly<Record<string, readonly ReviewSubject[]>>
}

// Presentational list + empty state for the renter's own bookings (#543). The
// route owns the loader/useSuspenseQuery and the renterId; this stays a pure
// function of the resolved rows so it is unit-testable (FC/IS — the shell does
// I/O, this renders). Each card links to the booking's confirmation/detail page.
export function MyBookingsView({
  bookings,
  locale,
  threadIdByBooking,
  reviewedSubjectsByBooking = {},
}: MyBookingsViewProps) {
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
        // #1083: show the post-trip prompt only once the review state has resolved
        // (an empty array = loaded, nothing reviewed yet; undefined = still loading).
        const reviewed = reviewedSubjectsByBooking[booking.id]
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
                {/* Each datetime stays an unbreakable unit, but the row may wrap at
                    the separator so a ~45-char EN range never forces the card to
                    overflow horizontally on a narrow phone (#1301). */}
                <span className="text-sm text-muted-foreground">
                  <span className="whitespace-nowrap">
                    {formatDateTime(booking.startAt, locale)}
                  </span>
                  {' – '}
                  <span className="whitespace-nowrap">{formatDateTime(booking.endAt, locale)}</span>
                </span>
              </div>
              <span className="text-right text-lg font-semibold tabular-nums">
                {booking.totalPrice == null ? '—' : formatJpy(booking.totalPrice)}
              </span>
            </Link>
            {threadId ? (
              <MessageHostLink threadId={threadId} locale={locale} className="self-start" />
            ) : null}
            {booking.status === 'COMPLETED' && reviewed !== undefined ? (
              <ReviewPrompt
                bookingId={booking.id}
                bookingCode={booking.bookingCode}
                reviewedSubjects={reviewed}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
