import { Button } from '@/components/ui/button'
import { formatJstDateTimeLocal } from '@/lib/datetime'
import type { CreateBookingDraft } from '@/vite/bookings/api'
import { useFeatureFlag } from '@/vite/config'
import { ReviewList, vehicleReviewsInfiniteQueryOptions } from '@/vite/reviews'
import { carryForwardFilters } from '@/vite/storefronts/params'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AddOnsStep } from './AddOnsStep'
import { ConfirmStep } from './ConfirmStep'
import { DateRangeStep } from './DateRangeStep'
import { InsuranceStep } from './InsuranceStep'
import { PaymentStep } from './PaymentStep'
import { ReservationSummaryBar } from './ReservationSummaryBar'
import type { ReservationAddOn, ReservationInsuranceOption } from './api'
import { estimateReservation } from './pricing'
import { type ReservationSubject, subjectDisplay, subjectRates } from './subject'

interface ReservationWizardProps {
  readonly locale: string
  /** What the renter is booking: a concrete car (SPECIFIC) or a class-combo deal
   *  where the operator assigns the exact car before pickup (CLASS_COMBO) — #464. */
  readonly subject: ReservationSubject
  /** Storefront the subject belongs to — pickup and dropoff for the MVP (one location). */
  readonly locationId: string
  readonly addOns: ReservationAddOn[]
  readonly insuranceOptions: ReservationInsuranceOption[]
  readonly from: Date
  readonly to: Date
  /** Active search filters carried in from the storefront so the "back to listing"
   *  link returns to a listing that still has the renter's class/region/pickup (#1291). */
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
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
  subject,
  locationId,
  addOns,
  insuranceOptions,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: ReservationWizardProps) {
  const t = useTranslations('reservation')
  const reviewsEnabled = useFeatureFlag('REVIEWS')
  const [stepIndex, setStepIndex] = useState(0)
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([])
  const [insuranceOptionId, setInsuranceOptionId] = useState<string | null>(null)
  // One key per wizard mount so a double-tap on Reserve replays the same booking
  // (server idempotency) instead of racing the exclusion constraint into a 409.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  // #1448: a concrete car has published reviews to show; a class-combo has no car
  // assigned yet, so there is nothing to review. The query stays disabled (never
  // fetches) unless the subject is SPECIFIC and the REVIEWS flag is on.
  const vehicleId = subject.kind === 'SPECIFIC' ? subject.vehicle.id : null
  const {
    data: reviewPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    ...vehicleReviewsInfiniteQueryOptions(vehicleId ?? ''),
    enabled: reviewsEnabled && vehicleId !== null,
  })
  const vehicleReviews = reviewPages?.pages.flatMap((page) => page.reviews)

  const step: Step = STEPS[stepIndex] ?? 'dates'
  const display = subjectDisplay(subject)
  const selectedAddOns = addOns.filter((addOn) => selectedAddOnIds.includes(addOn.id))
  const insurance = insuranceOptions.find((option) => option.id === insuranceOptionId) ?? null
  const estimate = estimateReservation({
    // A class-combo prices off the class rate plan (hourly always null); the shared
    // pricing floors a partial day to the day rate, so the up-front quote matches
    // the server total the operator's assigned car will carry (#464).
    vehicle: subjectRates(subject),
    from,
    to,
    insuranceDailyPriceJpy: insurance?.dailyPriceJpy ?? null,
    addOnPricesJpy: selectedAddOns.map((addOn) => addOn.priceJpy),
  })
  // `disclaimerAccepted` is intentionally absent — consent is a payment-step gate
  // (#613), supplied by PaymentStep at submit, not a wizard selection. The body
  // matches one arm of the server's discriminated union (#464): a concrete car
  // (SPECIFIC) or a vehicle class (CLASS_COMBO), the operator assigns the car later.
  const bookingCommon = {
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    startAt: from.toISOString(),
    endAt: to.toISOString(),
    insuranceOptionId,
    addOnIds: selectedAddOnIds,
    idempotencyKey,
  }
  const bookingInput: CreateBookingDraft =
    subject.kind === 'SPECIFIC'
      ? { fulfillmentMode: 'SPECIFIC', requestedVehicleId: subject.vehicle.id, ...bookingCommon }
      : { fulfillmentMode: 'CLASS_COMBO', classId: subject.offering.classId, ...bookingCommon }
  // Only a class-combo carries the "car assigned before pickup" note; a SPECIFIC
  // booking already names its car, so the note would be false there.
  const assignmentNote = subject.kind === 'CLASS_COMBO' ? t('classAssignmentNote') : null

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
        <>
          <DateRangeStep locale={locale} vehicleName={display.label} from={from} to={to} />
          {/* #1448: the picked car's public reviews, on the orient step only — hidden
              once the renter moves on to extras/insurance/payment. ReviewList also
              self-gates on the REVIEWS flag, so this is double-sealed. Skipped entirely
              when the car has no reviews yet: the storefront browse page shows an empty
              state, but a "No reviews yet" placeholder is just noise mid-checkout. */}
          {vehicleId !== null && vehicleReviews !== undefined && vehicleReviews.length > 0 ? (
            <ReviewList
              reviews={vehicleReviews}
              hasMore={hasNextPage}
              onLoadMore={() => {
                void fetchNextPage()
              }}
              isLoadingMore={isFetchingNextPage}
            />
          ) : null}
        </>
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
          assignmentNote={assignmentNote}
        />
      ) : null}
      {step === 'payment' ? (
        <PaymentStep locale={locale} bookingInput={bookingInput} onBack={goBack} />
      ) : null}

      {step !== 'payment' ? (
        <ReservationSummaryBar
          totalJpy={estimate.totalJpy}
          back={
            stepIndex > 0 ? (
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
                search={{
                  from: formatJstDateTimeLocal(from),
                  to: formatJstDateTimeLocal(to),
                  ...carryForwardFilters({ class: classFilter, pickupLocationId, region }),
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                {t('nav.backToListing')}
              </Link>
            )
          }
          next={
            <Button type="button" onClick={goNext}>
              {step === 'confirm' ? t('nav.toPayment') : t('nav.continue')}
            </Button>
          }
        />
      ) : null}
    </div>
  )
}
