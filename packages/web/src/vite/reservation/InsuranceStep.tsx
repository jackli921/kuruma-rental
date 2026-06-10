import { formatJpy } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { ReservationInsuranceOption } from './api'

interface InsuranceStepProps {
  readonly options: ReservationInsuranceOption[]
  readonly selectedId: string | null
  readonly onSelect: (id: string | null) => void
}

// Single radio group so the browser enforces single-select across "No insurance"
// + every option.
const RADIO_GROUP = 'reservation-insurance'

/**
 * Step 3 (#460): the renter chooses at most one coverage option (or declines).
 * Insurance is billed per rental day. A null selection ("No insurance") is the
 * default and a valid choice — coverage is optional (booking.insuranceOptionId
 * is nullable).
 */
export function InsuranceStep({ options, selectedId, onSelect }: InsuranceStepProps) {
  const t = useTranslations('reservation')

  const deductibleLabel = (deductibleJpy: number | null): string =>
    deductibleJpy != null && deductibleJpy > 0
      ? t('insurance.deductible', { amount: formatJpy(deductibleJpy) })
      : t('insurance.noDeductible')

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('insurance.heading')}</h2>
      <ul className="space-y-3">
        <li>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4">
            <input
              type="radio"
              name={RADIO_GROUP}
              className="mt-1 size-4"
              checked={selectedId === null}
              onChange={() => onSelect(null)}
            />
            <span className="flex-1">
              <span className="block font-medium">{t('insurance.none')}</span>
              <span className="block text-sm text-muted-foreground">
                {t('insurance.noneDescription')}
              </span>
            </span>
          </label>
        </li>
        {options.map((option) => (
          <li key={option.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4">
              <input
                type="radio"
                name={RADIO_GROUP}
                className="mt-1 size-4"
                checked={selectedId === option.id}
                onChange={() => onSelect(option.id)}
              />
              <span className="flex-1">
                <span className="block font-medium">{option.name}</span>
                {option.description ? (
                  <span className="block text-sm text-muted-foreground">{option.description}</span>
                ) : null}
                <span className="block text-sm text-muted-foreground">
                  {deductibleLabel(option.deductibleJpy)}
                </span>
              </span>
              <span className="font-medium">
                {t('insurance.perDay', { price: formatJpy(option.dailyPriceJpy) })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {options.length === 0 ? (
        <p className="text-muted-foreground">{t('insurance.empty')}</p>
      ) : null}
    </section>
  )
}
