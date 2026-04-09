import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { getVehicleById } from '@/lib/vehicles'
import { ArrowLeft, Calendar, Car, Fuel, Settings2, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

interface VehicleDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function VehicleDetailPage({ params }: VehicleDetailPageProps) {
  const { id } = await params
  const [vehicle, t] = await Promise.all([getVehicleById(id), getTranslations('vehicles.detail')])

  if (!vehicle) {
    notFound()
  }

  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')
  const photos = vehicle.photos ?? []
  const primaryPhoto = photos[0]

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <Link
            href="/vehicles"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'gap-1.5 text-muted-foreground',
            )}
          >
            <ArrowLeft className="size-4" />
            {t('backToList')}
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Photo gallery */}
          <section aria-label={t('photos')}>
            {primaryPhoto ? (
              <div className="space-y-3">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                  <img
                    src={primaryPhoto}
                    alt={vehicle.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                {photos.length > 1 && (
                  <div className="grid grid-cols-3 gap-3">
                    {photos.slice(1, 4).map((photo) => (
                      <div key={photo} className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                        <img
                          src={photo}
                          alt={vehicle.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted flex items-center justify-center">
                <Car className="size-16 text-muted-foreground/30" />
              </div>
            )}
          </section>

          {/* Vehicle info */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{vehicle.name}</h1>
              {vehicle.description && (
                <p className="mt-3 text-base text-muted-foreground">{vehicle.description}</p>
              )}
            </div>

            {/* Specs card */}
            <Card>
              <CardContent className="pt-2">
                <h2 className="text-lg font-medium mb-4">{t('specs')}</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2.5">
                    <Users className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {t('seats', { count: vehicle.seats })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Settings2 className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('transmission')}</p>
                      <p className="text-sm font-medium">{transmissionLabel}</p>
                    </div>
                  </div>
                  {vehicle.fuelType && (
                    <div className="flex items-center gap-2.5">
                      <Fuel className="size-5 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">{t('fuelType')}</p>
                        <p className="text-sm font-medium">{vehicle.fuelType}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Book CTA */}
            <Link
              href={`/bookings/new?vehicleId=${vehicle.id}`}
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'w-full gap-2 text-base',
              )}
            >
              <Calendar className="size-5" />
              {t('bookCta')}
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
