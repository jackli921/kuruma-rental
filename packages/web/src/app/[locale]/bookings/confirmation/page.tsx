import { auth } from '@/auth'
import { PreAuthHandoffCard } from '@/components/bookings/PreAuthHandoffCard'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { getApiToken } from '@/lib/api-token'
import { getBookingById } from '@/lib/bookings'
import { formatDateTime, formatJpy } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetchClassById } from '@/modules/classes'
import { CheckCircle } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'

interface ConfirmationPageProps {
  searchParams: Promise<{ bookingId?: string }>
}

// Slice 6 (#392): confirmation after a successful vehicle booking. Shows the
// reservation code, dates, the locked insurance choice (insuranceSnapshot), and
// any fees that could be charged at drop-off (feeSnapshot — empty => no block).
export default async function BookingConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const { bookingId } = await searchParams
  const [session, t, locale] = await Promise.all([
    auth(),
    getTranslations('bookings.confirmation'),
    getLocale(),
  ])

  if (!session?.user?.id) {
    redirect(`/${locale}/login`)
  }

  if (!bookingId) {
    notFound()
  }

  const booking = await getBookingById(bookingId)
  if (!booking || booking.renterId !== session.user.id) {
    notFound()
  }

  const token = await getApiToken()
  const vehicleClass = booking.classId ? await fetchClassById(booking.classId, token) : null

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
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
            href="/bookings"
            className={cn(buttonVariants({ variant: 'default' }), 'flex-1 justify-center')}
          >
            {t('viewBookings')}
          </Link>
          <Link
            href="/vehicles"
            className={cn(buttonVariants({ variant: 'outline' }), 'flex-1 justify-center')}
          >
            {t('backToVehicles')}
          </Link>
        </div>
      </div>
    </main>
  )
}
