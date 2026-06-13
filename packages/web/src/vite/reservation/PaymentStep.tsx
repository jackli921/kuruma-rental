import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-error'
import { type CreateBookingInput, createBooking } from '@/vite/bookings/api'
import { useSession } from '@/vite/session'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface PaymentStepProps {
  readonly locale: string
  /** Consent is supplied here, not by the wizard — see `disclaimerAccepted` below. */
  readonly bookingInput: Omit<CreateBookingInput, 'disclaimerAccepted'>
  readonly onBack: () => void
}

/**
 * Final wizard step (#511): instant-book submit. The button POSTs /bookings (CSRF
 * + idempotency key) and, on the CONFIRMED booking, routes to the confirmation
 * page. There is no online payment in this path (user decision): the renter pays
 * at pickup via the operator's pre-auth handoff link shown on confirmation. Errors
 * map the endpoint's real status union — 409 (vehicle just taken), 403 (document
 * verification, defensive: the gate is OFF for the demo, #511), else generic.
 */
export function PaymentStep({ locale, bookingInput, onBack }: PaymentStepProps) {
  const t = useTranslations('reservation')
  const navigate = useNavigate()
  const session = useSession()
  const csrfToken = session.data?.csrfToken
  // Liability-disclaimer consent (#613) replaces the dropped online document upload:
  // the renter acknowledges in-person verification at pickup before instant-booking.
  const [accepted, setAccepted] = useState(false)

  const mutation = useMutation({
    mutationFn: (): Promise<{ id: string }> => {
      if (!csrfToken) throw new ApiError('Not signed in', 401)
      return createBooking({ ...bookingInput, disclaimerAccepted: accepted }, csrfToken)
    },
    onSuccess: (booking) => {
      // Navigate with only the id — do NOT seed the ['bookings', id] cache with
      // the POST result. POST returns the raw booking; only GET /bookings/:id
      // enriches it with operator.preAuthHandoffUrl (the pay-at-pickup CTA).
      // Seeding here would let the confirmation loader reuse the un-enriched
      // result and hide the pre-auth card on the success path (#511 review).
      navigate({
        to: '/$locale/bookings/confirmation',
        params: { locale },
        search: { bookingId: booking.id },
      })
    },
  })

  const message = ((): string | null => {
    const error = mutation.error
    if (!error) return null
    // 409 (raced) and 400 (vehicle no longer available / not found) share one
    // remedy for the renter: go back and pick another car.
    if (error instanceof ApiError && (error.status === 409 || error.status === 400))
      return t('payment.errorConflict')
    if (error instanceof ApiError && error.status === 403) return t('payment.errorDocs')
    if (error instanceof ApiError && error.status === 401) return t('payment.errorAuth')
    return t('payment.errorGeneric')
  })()

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('payment.heading')}</h2>
      <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-muted-foreground">
        {t('payment.instantBook')}
      </p>
      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {message}
        </p>
      ) : null}
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <p id="disclaimer-terms" className="text-sm text-muted-foreground">
          {t('disclaimer.terms')}
        </p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            aria-describedby="disclaimer-terms"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
          />
          <span className="text-foreground">{t('disclaimer.label')}</span>
        </label>
      </div>
      {accepted ? null : (
        // a11y (#638): a disabled submit gives a screen-reader user no reason it
        // is dead. Tie the button to this hint via aria-describedby so the
        // "consent required" explanation is announced on focus.
        <p id="disclaimer-consent-hint" className="text-sm text-muted-foreground">
          {t('disclaimer.consentRequired')}
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={mutation.isPending}>
          {t('nav.back')}
        </Button>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !csrfToken || !accepted}
          aria-describedby={accepted ? undefined : 'disclaimer-consent-hint'}
        >
          {mutation.isPending ? t('payment.submitting') : t('payment.submit')}
        </Button>
      </div>
    </section>
  )
}
