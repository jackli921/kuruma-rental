import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { getBookingById } from '@/lib/bookings'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getVehicleById } from '@/lib/vehicles'
import { CheckCircle } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

interface ConfirmationPageProps {
  searchParams: Promise<{ bookingId?: string; vehicleId?: string }>
}

export default async function BookingConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const { bookingId, vehicleId } = await searchParams
  const [t, locale] = await Promise.all([
    getTranslations('bookings.confirmation'),
    getLocale(),
  ])

  if (!bookingId) {
    notFound()
  }

  const booking = await getBookingById(bookingId)
  if (!booking) {
    notFound()
  }

  const vehicle = vehicleId ? await getVehicleById(vehicleId) : null

  const startDate = formatDateTime(new Date(booking.startAt), locale)
  const endDate = formatDateTime(new Date(booking.endAt), locale)

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <CheckCircle className="size-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-2 space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{t('bookingId')}</span>
              <span className="text-sm font-mono">{booking.id.slice(0, 8)}</span>
            </div>
            {vehicle && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{t('vehicle')}</span>
                <span className="text-sm font-medium">{vehicle.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{t('pickupDate')}</span>
              <span className="text-sm">{startDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{t('returnDate')}</span>
              <span className="text-sm">{endDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{t('status')}</span>
              <span className="text-sm font-medium text-green-600">{t('confirmed')}</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
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
