import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime, formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CancelBookingDialog } from '@/vite/bookings/CancelBookingDialog'
import { PreAuthHandoffCard } from '@/vite/bookings/PreAuthHandoffCard'
import type { BookingDto } from '@/vite/bookings/api'
import { buildStorefrontSearch } from '@/vite/bookings/storefront-link'
import { isCancellationEnabled } from '@/vite/config/features'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { Link } from '@tanstack/react-router'
import { CheckCircle } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface BookingConfirmationViewProps {
  readonly booking: BookingDto
  /** Resolved class label, or `null` when archived/unknown — the row is omitted. */
  readonly vehicleClass: VehicleClassData | null
  /** Session CSRF token for the self-cancel write; `null` hides the cancel control (#856). */
  readonly csrfToken: string | null
}

// Instant-book confirmation (#511, ported from the frozen Next page). Pure
// presentational: the route resolves the booking + class and i18n; this renders
// the reservation code, dates, the locked insurance choice (insuranceSnapshot),
// the operator pre-auth handoff CTA, and any drop-off fees (feeSnapshot — empty
// => no block). Ownership is server-enforced (GET /bookings/:id is IDOR-sealed,
// #396), so there is no client-side renter check.
export function BookingConfirmationView({
  booking,
  vehicleClass,
  csrfToken,
}: BookingConfirmationViewProps) {
  const t = useTranslations('bookings.confirmation')
  const locale = useLocale()

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <CheckCircle className="mx-auto mb-4 size-12 text-green-600" />
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-2">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('bookingCode')}</span>
            <span className="font-mono text-sm font-semibold">{booking.bookingCode}</span>
          </div>
          {vehicleClass && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{t('vehicleClass')}</span>
              <span className="text-sm font-medium">{vehicleClass.name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('pickupDate')}</span>
            <span className="text-sm">{formatDateTime(booking.startAt, locale)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('returnDate')}</span>
            <span className="text-sm">{formatDateTime(booking.endAt, locale)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('insurance')}</span>
            <span className="text-sm">
              {booking.insuranceSnapshot
                ? `${booking.insuranceSnapshot.name} · ${formatJpy(booking.insuranceSnapshot.dailyPriceJpy)}${t('perDay')}`
                : t('insuranceDeclined')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('status')}</span>
            <span className="text-sm font-medium text-green-600">{t('confirmed')}</span>
          </div>
        </CardContent>
      </Card>

      {booking.operator?.name && (
        <Card className="mt-4">
          <CardContent className="flex items-center justify-between gap-4 pt-2">
            <div>
              <p className="text-sm text-muted-foreground">{t('rentalCompany')}</p>
              <p className="font-medium">{booking.operator.name}</p>
            </div>
            <Link
              to="/$locale/storefronts/$locationId"
              params={{ locale, locationId: booking.pickupLocationId }}
              search={buildStorefrontSearch(booking)}
              className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}
            >
              {t('viewStorefront')}
            </Link>
          </CardContent>
        </Card>
      )}

      <PreAuthHandoffCard
        url={booking.operator?.preAuthHandoffUrl ?? null}
        title={t('preAuthTitle')}
        explain={t('preAuthExplain')}
        ctaLabel={t('preAuthCta')}
        cancellationContact={t('cancellationContact', { operator: booking.operator?.name ?? '' })}
      />

      {booking.feeSnapshot.length > 0 && (
        <Card className="mt-4">
          <CardContent className="space-y-3 pt-2">
            <h2 className="text-sm font-semibold">{t('potentialChargesTitle')}</h2>
            <ul className="space-y-2">
              {booking.feeSnapshot.map((fee) => (
                <li
                  key={`${fee.feeType}-${fee.vehicleClassId ?? 'all'}`}
                  className="flex justify-between text-sm"
                >
                  <span className="text-muted-foreground">{t(`fees.type.${fee.feeType}`)}</span>
                  <span>
                    {formatJpy(fee.amountJpy)} {t(`fees.unit.${fee.unit}`)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('fees.disclaimer')}</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          to="/$locale/bookings"
          params={{ locale }}
          className={cn(buttonVariants({ variant: 'default' }), 'flex-1 justify-center')}
        >
          {t('viewBookings')}
        </Link>
        <Link
          to="/$locale/vehicles"
          params={{ locale }}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1 justify-center')}
        >
          {t('backToVehicles')}
        </Link>
      </div>

      {/* #856: self-cancel is offered only for a CONFIRMED booking (an ACTIVE/
          COMPLETED/CANCELLED one is past the renter's reach) and only when a CSRF
          token is present to authorize the write. */}
      {isCancellationEnabled() && booking.status === 'CONFIRMED' && csrfToken && (
        <div className="mt-8 flex justify-center border-t border-border pt-6">
          <CancelBookingDialog
            bookingId={booking.id}
            csrfToken={csrfToken}
            startAt={booking.startAt}
            totalPrice={booking.totalPrice}
            operatorName={booking.operator?.name ?? null}
          />
        </div>
      )}
    </div>
  )
}
