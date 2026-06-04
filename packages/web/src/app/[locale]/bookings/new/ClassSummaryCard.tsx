import { Card, CardContent } from '@/components/ui/card'
import type { VehicleClassData } from '@/modules/classes'
import { Briefcase, Car, Fuel, Settings2, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'

interface ClassSummaryCardProps {
  vehicleClass: VehicleClassData
}

// Server component: compact class card shown above the booking form so the
// renter can confirm they're booking the right class without leaving the page.
export function ClassSummaryCard({ vehicleClass: vc }: ClassSummaryCardProps) {
  const t = useTranslations('bookings.new')
  const transmissionLabel = vc.transmission === 'AUTO' ? t('auto') : t('manual')
  const primaryPhoto = vc.photos[0]

  return (
    <Card>
      <CardContent className="pt-2">
        <h2 className="text-lg font-medium mb-4">{t('classInfo')}</h2>
        <div className="flex gap-4">
          {primaryPhoto ? (
            <div className="relative w-32 h-24 overflow-hidden rounded-lg bg-muted shrink-0">
              <Image src={primaryPhoto} alt={vc.name} fill className="object-cover" sizes="128px" />
            </div>
          ) : (
            <div className="w-32 h-24 overflow-hidden rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Car className="size-8 text-muted-foreground/30" />
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-base font-medium">{vc.name}</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="size-4" />
                {t('seats', { count: vc.seats })}
              </span>
              <span className="flex items-center gap-1">
                <Settings2 className="size-4" />
                {transmissionLabel}
              </span>
              {vc.fuelType && (
                <span className="flex items-center gap-1">
                  <Fuel className="size-4" />
                  {vc.fuelType}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Briefcase className="size-4" />
                {t('luggage', { count: vc.luggageCapacity })}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
