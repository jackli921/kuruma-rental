import { Button } from '@/components/ui/button'
import {
  ApiError,
  DOCUMENT_VERIFICATION_REQUIRED,
  OPERATOR_TERMS_CHANGED,
  OPERATOR_TERMS_REQUIRED,
} from '@/lib/api-error'
import { type CreateBookingDraft, createBooking } from '@/vite/bookings/api'
import { useFeatureFlag } from '@/vite/config'
import { publishedOperatorTermsQueryOptions } from '@/vite/operator-terms'
import { useSession } from '@/vite/session'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { OperatorTermsModal } from './OperatorTermsModal'

interface PaymentStepProps {
  readonly locale: string
  /** The storefront's operator (#877) — used to fetch that operator's published
   *  rental terms for the clickwrap gate. From `detail.storefront.operatorId`. */
  readonly operatorId: string
  /** Consent is supplied here, not by the wizard — see `disclaimerAccepted` below.
   *  `CreateBookingDraft` distributes the Omit across the fulfillment-mode union so
   *  both arms keep their discriminant + id field (#464). */
  readonly bookingInput: CreateBookingDraft
  readonly onBack: () => void
}

/**
 * Final wizard step (#511): instant-book submit. The button POSTs /bookings (CSRF
 * + idempotency key) and, on the CONFIRMED booking, routes to the confirmation
 * page. There is no online payment in this path (user decision): the renter pays
 * at pickup via the operator's pre-auth handoff link shown on confirmation. Errors
 * map the endpoint's real status union — 409 (vehicle just taken), 403 *with the
 * DOCUMENT_VERIFICATION_REQUIRED code* (the #459 gate, defensive: OFF by default),
 * else generic.
 */
export function PaymentStep({ locale, operatorId, bookingInput, onBack }: PaymentStepProps) {
  const t = useTranslations('reservation')
  const navigate = useNavigate()
  const session = useSession()
  const queryClient = useQueryClient()
  const csrfToken = session.data?.csrfToken
  // #877 Slice B: gate Reserve on the operator's published rental terms, but only
  // when the OPERATOR_TERMS flag is on (dark otherwise). The query stays disabled
  // when the flag is off, so no request fires and `terms` is undefined.
  const operatorTermsEnabled = useFeatureFlag('OPERATOR_TERMS')
  const { data: terms } = useQuery({
    ...publishedOperatorTermsQueryOptions(operatorId, locale),
    enabled: operatorTermsEnabled,
  })
  const requiresTerms = operatorTermsEnabled && terms != null
  const [termsOpen, setTermsOpen] = useState(false)
  // Liability-disclaimer consent (#613) replaces the dropped online document upload:
  // the renter acknowledges in-person verification at pickup before instant-booking.
  const [accepted, setAccepted] = useState(false)

  const mutation = useMutation({
    mutationFn: (): Promise<{ id: string }> => {
      if (!csrfToken) throw new ApiError('Not signed in', 401)
      const base = { ...bookingInput, disclaimerAccepted: accepted }
      // Pin the exact version + displayed locale the renter agreed to, so the
      // server seals the same text it enforces (a stale pin → 422 CHANGED). Gated
      // on the flag too: a disabled query still returns CACHED terms, so binding on
      // `terms` alone would pin while dark. `operatorTermsEnabled && terms` narrows.
      const input =
        operatorTermsEnabled && terms
          ? {
              ...base,
              operatorRentalTermsAccepted: true,
              operatorRentalTermsAcceptedVersion: terms.version,
              locale,
            }
          : base
      return createBooking(input, csrfToken)
    },
    onError: (error) => {
      // The operator republished mid-checkout: pull the fresh terms and re-present
      // them so the renter re-agrees to what will actually be sealed.
      if (error instanceof ApiError && error.code === OPERATOR_TERMS_CHANGED) {
        void queryClient.invalidateQueries({
          queryKey: publishedOperatorTermsQueryOptions(operatorId, locale).queryKey,
        })
        setTermsOpen(true)
        return
      }
      // A race the client missed (terms appeared after our fetch): open the modal.
      if (error instanceof ApiError && error.code === OPERATOR_TERMS_REQUIRED) {
        setTermsOpen(true)
        return
      }
      // Any other failure surfaces on the step, so close the modal to reveal it.
      setTermsOpen(false)
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
    // #877: the operator changed their terms mid-checkout — the modal re-opens with
    // the fresh version; this banner explains the interruption behind it. A bare
    // REQUIRED (the modal handles it) shows no banner.
    if (error instanceof ApiError && error.code === OPERATOR_TERMS_CHANGED)
      return t('payment.termsChanged')
    if (error instanceof ApiError && error.code === OPERATOR_TERMS_REQUIRED) return null
    // Only the document-gate 403 (#459) means "upload documents"; key off the
    // machine code, not the bare status, so an unrelated 403 (e.g. an operator
    // booking outside its scope) doesn't dead-end the renter on a docs prompt.
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === DOCUMENT_VERIFICATION_REQUIRED
    )
      return t('payment.errorDocs')
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
          onClick={() => (requiresTerms ? setTermsOpen(true) : mutation.mutate())}
          disabled={mutation.isPending || !csrfToken || !accepted}
          aria-describedby={accepted ? undefined : 'disclaimer-consent-hint'}
        >
          {mutation.isPending ? t('payment.submitting') : t('payment.submit')}
        </Button>
      </div>
      {/* #877: rendered only when the flag is on AND the operator has published
          terms. Agreeing submits with the pinned version; the modal stays up while
          the mutation runs (pending) so success navigates away and a CHANGED 422
          re-presents fresh terms. */}
      {requiresTerms && terms ? (
        <OperatorTermsModal
          terms={terms}
          open={termsOpen}
          onOpenChange={setTermsOpen}
          onAgree={() => mutation.mutate()}
          pending={mutation.isPending}
        />
      ) : null}
    </section>
  )
}
