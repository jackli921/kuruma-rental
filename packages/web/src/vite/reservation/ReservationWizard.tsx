import { Button } from '@/components/ui/button'
import { formatJstDateTimeLocal } from '@/lib/datetime'
import type { CreateBookingInput } from '@/vite/bookings/api'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AddOnsStep } from './AddOnsStep'
import { ConfirmStep } from './ConfirmStep'
import { DateRangeStep } from './DateRangeStep'
import { InsuranceStep } from './InsuranceStep'
import { PaymentStep } from './PaymentStep'
import type { ReservationAddOn, ReservationInsuranceOption } from './api'
import { estimateReservation } from './pricing'

interface ReservationWizardProps {
  readonly locale: string
  readonly vehicle: AvailableVehicleData
  /** Storefront the vehicle belongs to — pickup and dropoff for the MVP (one location). */
  readonly locationId: string
  readonly addOns: ReservationAddOn[]
  readonly insuranceOptions: ReservationInsuranceOption[]
  readonly from: Date
  readonly to: Date
}

const STEPS = ['dates', 'addOns', 'insurance', 'confirm', 'payment'] as const
type Step = (typeof STEPS)[number]

/**
 * Multi-step reservation flow (#460): dates -> add-ons -> insurance -> confirm
 * -> payment. Selections live here; each step is a controlled child. The price
 * estimate recomputes from the current selection on every render and mirrors the
 * server total. The flow stops at the payment seam — no `POST /bookings` from the
 * web yet (held for #461).
 */
export function ReservationWizard({
  locale,
  vehicle,
  locationId,
  addOns,
  insuranceOptions,
  from,
  to,
}: ReservationWizardProps) {
  const t = useTranslations('reservation')
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([])
  const [insuranceOptionId, setInsuranceOptionId] = useState<string | null>(null)
  // One key per wizard mount so a double-tap on Reserve replays the same booking
  // (server idempotency) instead of racing the exclusion constraint into a 409.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const step: Step = STEPS[stepIndex] ?? 'dates'
  const selectedAddOns = addOns.filter((addOn) => selectedAddOnIds.includes(addOn.id))
  const insurance = insuranceOptions.find((option) => option.id === insuranceOptionId) ?? null
  const estimate = estimateReservation({
    vehicle: { dailyRateJpy: vehicle.dailyRateJpy, hourlyRateJpy: vehicle.hourlyRateJpy },
    from,
    to,
    insuranceDailyPriceJpy: insurance?.dailyPriceJpy ?? null,
    addOnPricesJpy: selectedAddOns.map((addOn) => addOn.priceJpy),
  })
  // `disclaimerAccepted` is intentionally absent — consent is a payment-step gate
  // (#613), supplied by PaymentStep at submit, not a wizard selection.
  const bookingInput: Omit<CreateBookingInput, 'disclaimerAccepted'> = {
    requestedVehicleId: vehicle.id,
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    startAt: from.toISOString(),
    endAt: to.toISOString(),
    insuranceOptionId,
    addOnIds: selectedAddOnIds,
    idempotencyKey,
  }

  const toggleAddOn = (id: string): void =>
    setSelectedAddOnIds((ids) =>
      ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id],
    )
  const goNext = (): void => setStepIndex((index) => Math.min(index + 1, STEPS.length - 1))
  const goBack = (): void => setStepIndex((index) => Math.max(index - 1, 0))

  const stepLabels: Record<Step, string> = {
    dates: t('steps.dates'),
    addOns: t('steps.addOns'),
    insurance: t('steps.insurance'),
    confirm: t('steps.confirm'),
    payment: t('steps.payment'),
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {STEPS.map((name, index) => (
            <li
              key={name}
              aria-current={index === stepIndex ? 'step' : undefined}
              className={
                index === stepIndex ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }
            >
              {index + 1}. {stepLabels[name]}
            </li>
          ))}
        </ol>
      </header>

      {step === 'dates' ? (
        <DateRangeStep locale={locale} vehicleName={vehicle.name} from={from} to={to} />
      ) : null}
      {step === 'addOns' ? (
        <AddOnsStep addOns={addOns} selectedIds={selectedAddOnIds} onToggle={toggleAddOn} />
      ) : null}
      {step === 'insurance' ? (
        <InsuranceStep
          options={insuranceOptions}
          selectedId={insuranceOptionId}
          onSelect={setInsuranceOptionId}
        />
      ) : null}
      {step === 'confirm' ? (
        <ConfirmStep
          estimate={estimate}
          selectedAddOns={selectedAddOns}
          insuranceName={insurance?.name ?? null}
          pickupAt={from}
        />
      ) : null}
      {step === 'payment' ? (
        <PaymentStep locale={locale} bookingInput={bookingInput} onBack={goBack} />
      ) : null}

      {step !== 'payment' ? (
        <div className="flex items-center justify-between gap-4">
          {stepIndex > 0 ? (
            <Button type="button" variant="outline" onClick={goBack}>
              {t('nav.back')}
            </Button>
          ) : (
            // First step has no in-wizard back; link out to the storefront the
            // renter came from so they're never stranded (#962). from/to are Date
            // objects, serialized to JST datetime-local so the storefront route's
            // parseSearchRange accepts them (a raw Date becomes an ISO instant it
            // rejects, redirecting to /search). Styled as a muted link mirroring
            // StorefrontDetailView's back affordance.
            <Link
              to="/$locale/storefronts/$locationId"
              params={{ locale, locationId }}
              search={{ from: formatJstDateTimeLocal(from), to: formatJstDateTimeLocal(to) }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              {t('nav.backToListing')}
            </Link>
          )}
          <Button type="button" onClick={goNext}>
            {step === 'confirm' ? t('nav.toPayment') : t('nav.continue')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
