import { formatJpy } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { ReservationAddOn } from './api'

interface AddOnsStepProps {
  readonly addOns: ReservationAddOn[]
  readonly selectedIds: readonly string[]
  readonly onToggle: (id: string) => void
}

/**
 * Step 2 (#460): the renter picks optional paid extras (baby seat, ETC card…).
 * Each is a flat per-rental charge and multi-selectable (one of each; quantity
 * is MVP-out). Selection state lives in the wizard; this step only renders +
 * reports toggles.
 */
export function AddOnsStep({ addOns, selectedIds, onToggle }: AddOnsStepProps) {
  const t = useTranslations('reservation')

  if (addOns.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('addOns.heading')}</h2>
        <p className="text-muted-foreground">{t('addOns.empty')}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('addOns.heading')}</h2>
      <ul className="space-y-3">
        {addOns.map((addOn) => (
          <li key={addOn.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={selectedIds.includes(addOn.id)}
                onChange={() => onToggle(addOn.id)}
              />
              <span className="flex-1">
                <span className="block font-medium">{addOn.name}</span>
                {addOn.description ? (
                  <span className="block text-sm text-muted-foreground">{addOn.description}</span>
                ) : null}
              </span>
              <span className="font-medium">
                {t('addOns.price', { price: formatJpy(addOn.priceJpy) })}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
