import { formatDateTime, formatJpy } from '@/lib/format'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import { Link } from '@tanstack/react-router'
import { CalendarX } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface OperatorBookingsViewProps {
  readonly bookings: readonly OperatorBookingRow[]
  readonly locale: string
}

// Presentational table + empty state. The route owns the loader/useSuspenseQuery
// and the pending/error boundaries; this stays a pure function of the resolved
// rows so it is unit-testable (FC/IS — the shell does I/O, this renders).
export function OperatorBookingsView({ bookings, locale }: OperatorBookingsViewProps) {
  const t = useTranslations('bookings.operator')
  const dash = t('none')

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
        <CalendarX className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t('columns.code')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.vehicle')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.renter')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.range')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('columns.total')}</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => (
            <tr
              key={booking.id}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3 font-mono font-medium">
                <Link
                  to="/$locale/manage/bookings/$bookingId"
                  params={{ locale, bookingId: booking.id }}
                  aria-label={t('viewAria', { code: booking.bookingCode })}
                  className="rounded underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {booking.bookingCode}
                </Link>
              </td>
              <td className="px-4 py-3">{booking.vehicleName ?? dash}</td>
              <td className="px-4 py-3">{booking.renter?.name ?? booking.renter?.email ?? dash}</td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                {`${formatDateTime(booking.startAt, locale)} – ${formatDateTime(booking.endAt, locale)}`}
              </td>
              <td className="px-4 py-3">{t(`status.${booking.status}`)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {booking.totalPrice == null ? dash : formatJpy(booking.totalPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
