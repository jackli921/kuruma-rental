import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-error'
import {
  type BookingDto,
  type CreateBookingInput,
  bookingByIdQueryOptions,
  createBooking,
} from '@/vite/bookings/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

interface PaymentStepProps {
  readonly locale: string
  readonly bookingInput: CreateBookingInput
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
  const queryClient = useQueryClient()
  const session = useSession()
  const csrfToken = session.data?.csrfToken

  const mutation = useMutation({
    mutationFn: (): Promise<BookingDto> => {
      if (!csrfToken) throw new ApiError('Not signed in', 401)
      return createBooking(bookingInput, csrfToken)
    },
    onSuccess: (booking) => {
      // Seed the cache with the booking we already hold so the confirmation
      // route renders immediately instead of refetching GET /bookings/:id.
      queryClient.setQueryData(bookingByIdQueryOptions(booking.id).queryKey, booking)
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
      <div className="flex items-center justify-between gap-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={mutation.isPending}>
          {t('nav.back')}
        </Button>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !csrfToken}
        >
          {mutation.isPending ? t('payment.submitting') : t('payment.submit')}
        </Button>
      </div>
    </section>
  )
}
