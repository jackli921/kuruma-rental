import { auth } from '@/auth'
import { EmptyState } from '@/components/EmptyState'
import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { getBookingsByRenterId } from '@/lib/bookings'
import { cn } from '@/lib/utils'
import { Calendar, Car } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Image from 'next/image'
import { redirect } from 'next/navigation'

export default async function BookingsListPage() {
  const [session, t] = await Promise.all([auth(), getTranslations('bookings.list')])

  if (!session?.user?.id) {
    redirect('/login')
  }

  const bookings = await getBookingsByRenterId(session.user.id)

  return (
    <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
        </div>

        {bookings.length === 0 ? (
          <EmptyState icon={Calendar} message={t('empty')} />
        ) : (
          <div className="space-y-4">
            {bookings.map((booking) => (
              <Card key={booking.id}>
                <CardContent className="pt-2">
                  <div className="flex gap-4">
                    {booking.vehiclePhoto ? (
                      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg">
                        <Image
                          src={booking.vehiclePhoto}
                          alt={booking.vehicleName}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      </div>
                    ) : (
                      <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Car className="size-8 text-muted-foreground/50" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-medium truncate">{booking.vehicleName}</h2>
                        <BookingStatusBadge status={booking.status} />
                      </div>

                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p>
                          {t('pickup')}: {booking.startAt.toLocaleDateString()}
                        </p>
                        <p>
                          {t('return')}: {booking.endAt.toLocaleDateString()}
                        </p>
                      </div>

                      <div className="mt-3">
                        <Link
                          href={`/bookings/confirmation?bookingId=${booking.id}`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                        >
                          {t('viewDetails')}
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
