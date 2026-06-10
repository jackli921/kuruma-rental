import { formatDateTime } from '@/lib/format'
import { useTranslations } from 'use-intl'
import { rentalDays } from './pricing'

interface DateRangeStepProps {
  readonly locale: string
  readonly vehicleName: string
  readonly from: Date
  readonly to: Date
}

/**
 * Step 1 of the reservation wizard (#460): a read-only confirmation of the
 * vehicle and the JST pickup/return window the renter already chose in search.
 * Dates are immutable here — changing them means re-running availability, so the
 * renter goes back to search rather than editing inline.
 */
export function DateRangeStep({ locale, vehicleName, from, to }: DateRangeStepProps) {
  const t = useTranslations('reservation')

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('dates.heading')}</h2>
      <p className="text-base font-medium">{vehicleName}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <dt className="text-sm text-muted-foreground">{t('dates.pickup')}</dt>
          <dd className="font-medium">{formatDateTime(from, locale)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <dt className="text-sm text-muted-foreground">{t('dates.return')}</dt>
          <dd className="font-medium">{formatDateTime(to, locale)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        {t('dates.duration', { count: rentalDays(from, to) })}
      </p>
    </section>
  )
}
