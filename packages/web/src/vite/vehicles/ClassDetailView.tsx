import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Briefcase, Car, Fuel, Settings2, Tag, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface ClassDetailViewProps {
  readonly vehicleClass: VehicleClassData
}

// Renter-facing class detail. Pure presentational — the route handles the slug
// lookup + notFound path, so this just renders.
export function ClassDetailView({ vehicleClass: vc }: ClassDetailViewProps) {
  const t = useTranslations('catalog.detail')
  const tAcriss = useTranslations('acriss')
  const tSize = useTranslations('luggageSize')
  const locale = useLocale()

  const transmissionLabel = vc.transmission === 'AUTO' ? t('auto') : t('manual')
  const photos = vc.photos
  const primaryPhoto = photos[0]
  // ACRISS label with raw-code fallback (#388): an off-dictionary code renders the
  // code rather than throwing a missing-key error.
  const acrissLabel = vc.acrissCode
    ? tAcriss.has(vc.acrissCode)
      ? tAcriss(vc.acrissCode)
      : vc.acrissCode
    : null

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <Link
          to="/$locale/vehicles"
          params={{ locale }}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'gap-1.5 text-muted-foreground',
          )}
        >
          <ArrowLeft className="size-4" />
          {t('backToCatalog')}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section aria-label={t('photos')}>
          {primaryPhoto ? (
            <div className="space-y-3">
              <div className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                <img src={primaryPhoto} alt={vc.name} className="w-full h-full object-cover" />
              </div>
              {photos.length > 1 && (
                <div className="grid grid-cols-3 gap-3">
                  {photos.slice(1, 4).map((photo) => (
                    <div key={photo} className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                      <img src={photo} alt={vc.name} className="w-full h-full object-cover" />
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

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{vc.name}</h1>
            {vc.description && (
              <p className="mt-3 text-base text-muted-foreground whitespace-pre-line">
                {vc.description}
              </p>
            )}
          </div>

          <Card>
            <CardContent className="pt-2">
              <h2 className="text-lg font-medium mb-4">{t('specs')}</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2.5">
                  <Users className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">{t('seats', { count: vc.seats })}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  <Settings2 className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('transmission')}</p>
                    <p className="text-sm font-medium">{transmissionLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Briefcase className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {t('luggage', { count: vc.luggageCapacity })}
                    <span className="text-muted-foreground"> · {tSize(vc.luggageSize)}</span>
                  </p>
                </div>
                {vc.fuelType && (
                  <div className="flex items-center gap-2.5">
                    <Fuel className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('fuelType')}</p>
                      <p className="text-sm font-medium">{vc.fuelType}</p>
                    </div>
                  </div>
                )}
                {acrissLabel && (
                  <div className="flex items-center gap-2.5">
                    <Tag className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('acrissCode')}</p>
                      <p className="text-sm font-medium">{acrissLabel}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* The direct booking flow (/bookings/new) is still deferred, so the
              class CTA routes to availability search — the renter picks dates and
              finds a store offering this class (5d-3). */}
          <Link
            to="/$locale/search"
            params={{ locale }}
            className={cn(
              buttonVariants({ variant: 'default', size: 'lg' }),
              'w-full gap-2 text-base',
            )}
          >
            {t('bookCta')}
          </Link>
        </div>
      </div>
    </div>
  )
}
