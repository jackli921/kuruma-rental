import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { CustomerBookingSummary } from '@kuruma/shared/types/customer'
import { getTranslations } from 'next-intl/server'

const STATUS_CLASS: Record<string, string> = {
  CONFIRMED: 'bg-blue-100 text-blue-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-slate-100 text-slate-700',
  CANCELLED: 'bg-rose-100 text-rose-800',
}

interface Props {
  bookings: CustomerBookingSummary[]
  locale: string
}

export async function CustomerBookingsTable({ bookings, locale }: Props) {
  const t = await getTranslations('business.customers')

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('bookingColumns.vehicle')}</TableHead>
            <TableHead>{t('bookingColumns.startAt')}</TableHead>
            <TableHead>{t('bookingColumns.endAt')}</TableHead>
            <TableHead>{t('bookingColumns.status')}</TableHead>
            <TableHead className="text-right">{t('bookingColumns.totalPrice')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((b) => (
            <TableRow key={b.id}>
              <TableCell>{b.vehicleName ?? b.vehicleId ?? '—'}</TableCell>
              <TableCell>{formatDateTime(b.startAt, locale)}</TableCell>
              <TableCell>{formatDateTime(b.endAt, locale)}</TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_CLASS[b.status] ?? ''
                  }`}
                >
                  {b.status}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {b.totalPrice != null ? formatJpy(b.totalPrice) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
