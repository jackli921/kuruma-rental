import { formatJpy } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { ReservationAddOn } from './api'
import type { ReservationEstimate } from './pricing'

interface ConfirmStepProps {
  readonly estimate: ReservationEstimate
  readonly selectedAddOns: ReservationAddOn[]
  /** Name of the chosen insurance option, or null when coverage was declined. */
  readonly insuranceName: string | null
}

/**
 * Step 4 (#460): an itemised price breakdown before payment. Mirrors the server
 * total (base + insurance + add-ons); fees are intentionally absent — they are
 * informational and not part of `totalPrice`. The note flags that the
 * authoritative charge (taxes, operator fees) is computed at payment (#461).
 */
export function ConfirmStep({ estimate, selectedAddOns, insuranceName }: ConfirmStepProps) {
  const t = useTranslations('reservation')

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

        {selectedAddOns.length > 0 ? (
          <div className="flex items-start justify-between gap-4 p-4">
            <dt className="flex flex-col">
              <span>{t('confirm.addOns')}</span>
              <ul className="text-sm text-muted-foreground">
                {selectedAddOns.map((addOn) => (
                  <li key={addOn.id}>{addOn.name}</li>
                ))}
              </ul>
            </dt>
            <dd className="font-medium">{formatJpy(estimate.addOnsJpy)}</dd>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 p-4 font-semibold">
          <dt>{t('confirm.total')}</dt>
          <dd>{formatJpy(estimate.totalJpy)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{t('confirm.note')}</p>
    </section>
  )
}
