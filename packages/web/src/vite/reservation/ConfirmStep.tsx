import { formatJpy } from '@/lib/format'
import { isCancellationEnabled } from '@/vite/config/features'
import { IndicativeNote, useIndicative } from '@/vite/currency'
import { useTranslations } from 'use-intl'
import { CancellationPolicy } from './CancellationPolicy'
import type { ReservationAddOn } from './api'
import type { ReservationEstimate } from './pricing'

interface ConfirmStepProps {
  readonly estimate: ReservationEstimate
  readonly selectedAddOns: ReservationAddOn[]
  /** Name of the chosen insurance option, or null when coverage was declined. */
  readonly insuranceName: string | null
  /** Pickup time — drives which cancellation tier is highlighted (#657). */
  readonly pickupAt: Date
}

/**
 * Step 4 (#460): an itemised price breakdown before payment. Mirrors the server
 * total (base + insurance + add-ons); fees are intentionally absent — they are
 * informational and not part of `totalPrice`. The note flags that the
 * authoritative charge (taxes, operator fees) is computed at payment (#461).
 */
export function ConfirmStep({
  estimate,
  selectedAddOns,
  insuranceName,
  pickupAt,
}: ConfirmStepProps) {
  const t = useTranslations('reservation')
  const tCurrency = useTranslations('currency')
  const { format: indicativeOf } = useIndicative()
  // The charge is always JPY; only flag that when a converted figure is on screen.
  const showCurrencyDisclaimer = indicativeOf(estimate.totalJpy) !== null

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('confirm.heading')}</h2>
      <dl className="divide-y divide-border rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-4 p-4">
          <dt>{t('confirm.base')}</dt>
          <dd className="font-medium">{formatJpy(estimate.baseJpy)}</dd>
        </div>

        {insuranceName !== null ? (
          <div className="flex items-center justify-between gap-4 p-4">
            <dt className="flex flex-col">
              <span>{t('confirm.insurance')}</span>
              <span className="text-sm text-muted-foreground">{insuranceName}</span>
            </dt>
            <dd className="font-medium">{formatJpy(estimate.insuranceJpy)}</dd>
          </div>
        ) : null}

        {selectedAddOns.map((addOn) => (
          <div key={addOn.id} className="flex items-center justify-between gap-4 p-4">
            <dt>{addOn.name}</dt>
            <dd className="font-medium">{formatJpy(addOn.priceJpy)}</dd>
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 p-4 font-semibold">
          <dt>{t('confirm.total')}</dt>
          <dd className="text-right">
            {formatJpy(estimate.totalJpy)}
            <IndicativeNote jpy={estimate.totalJpy} />
          </dd>
        </div>
      </dl>
      {showCurrencyDisclaimer && (
        <p className="text-xs text-muted-foreground">{tCurrency('disclaimer')}</p>
      )}
      <p className="text-sm text-muted-foreground">{t('confirm.note')}</p>
      {/* #937: self-cancel is gated for the beta demo (#868), so don't advertise the
          tiered policy at checkout when the feature is OFF — it would promise a flow
          the booking confirmation then hides. */}
      {isCancellationEnabled() && <CancellationPolicy pickupAt={pickupAt} />}
    </section>
  )
}
