import { formatDateTime, formatJpy } from '@/lib/format'
import type { BookingDto } from '@/vite/bookings/api'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorBookingDetailProps {
  readonly row: OperatorBookingRow
  readonly booking: BookingDto
  readonly locale: string
}

// Read-only operator booking detail (#512 follow-up). Pure presentation (FC/IS):
// the Sheet wrapper does the fetch; this renders. Vehicle + renter come from the
// already-expanded list `row` (GET /bookings/:id does NOT expand them), while the
// snapshots/total/notes come from the single-booking read. Mirrors the renter
// confirmation breakdown (insurance + fee snapshots), minus its renter CTAs, and
// reuses the `bookings.confirmation.fees.*` labels rather than duplicating them.
export function OperatorBookingDetail({ row, booking, locale }: OperatorBookingDetailProps) {
  const t = useTranslations('bookings.operator')
  const tc = useTranslations('bookings.confirmation')
  const dash = t('none')
  const ins = booking.insuranceSnapshot

  return (
    <div className="space-y-6 px-4 pb-6 text-sm">
      <p className="font-mono text-lg font-semibold tracking-tight">{booking.bookingCode}</p>

      <dl className="space-y-3">
        <DetailRow label={t('detail.status')}>{t(`status.${booking.status}`)}</DetailRow>
        <DetailRow label={t('detail.vehicle')}>{row.vehicleName ?? dash}</DetailRow>
        <DetailRow label={t('detail.renter')}>
          {row.renter?.name ?? row.renter?.email ?? dash}
        </DetailRow>
        <DetailRow label={t('detail.pickup')}>{formatDateTime(booking.startAt, locale)}</DetailRow>
        <DetailRow label={t('detail.return')}>{formatDateTime(booking.endAt, locale)}</DetailRow>
        <DetailRow label={t('detail.insurance')}>
          {ins
            ? `${ins.name} · ${formatJpy(ins.dailyPriceJpy)}${tc('perDay')}`
            : tc('insuranceDeclined')}
        </DetailRow>
        {ins?.deductibleJpy != null && (
          <DetailRow label={t('detail.deductible')}>{formatJpy(ins.deductibleJpy)}</DetailRow>
        )}
      </dl>

      {booking.addOnSnapshot.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('detail.addOns')}</h3>
          <ul className="space-y-1">
            {booking.addOnSnapshot.map((addOn) => (
              <li key={addOn.addOnId} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{addOn.name}</span>
                <span className="tabular-nums">{formatJpy(addOn.priceJpy)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {booking.feeSnapshot.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t('detail.charges')}</h3>
          <ul className="space-y-1">
            {booking.feeSnapshot.map((fee) => (
              <li
                key={`${fee.feeType}-${fee.vehicleClassId ?? 'all'}`}
                className="flex justify-between gap-4"
              >
                <span className="text-muted-foreground">{tc(`fees.type.${fee.feeType}`)}</span>
                <span className="tabular-nums">
                  {formatJpy(fee.amountJpy)} {tc(`fees.unit.${fee.unit}`)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{tc('fees.disclaimer')}</p>
        </section>
      )}

      {booking.notes != null && booking.notes !== '' && (
        <section className="space-y-1">
          <h3 className="font-semibold">{t('detail.notes')}</h3>
          <p className="whitespace-pre-wrap text-muted-foreground">{booking.notes}</p>
        </section>
      )}

      <div className="flex justify-between border-t border-border pt-3 font-semibold">
        <span>{t('detail.total')}</span>
        <span className="tabular-nums">
          {booking.totalPrice == null ? dash : formatJpy(booking.totalPrice)}
        </span>
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
