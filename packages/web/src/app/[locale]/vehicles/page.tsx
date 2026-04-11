import { ActiveFilters } from '@/components/vehicles/ActiveFilters'
import { RentalRulesBadge } from '@/components/vehicles/RentalRulesBadge'
import { Link } from '@/i18n/routing'
import { getAvailableVehicles } from '@/lib/vehicles'
import { Car, Fuel, Settings2, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [t, resolvedParams] = await Promise.all([getTranslations('vehicles'), searchParams])

  const from = asString(resolvedParams.from)
  const to = asString(resolvedParams.to)

  const vehicles = await getAvailableVehicles(from, to)

  return (
    <main className="flex-1 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>

        <ActiveFilters from={from} to={to} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          {vehicles.map((vehicle) => {
            const photo = vehicle.photos?.[0]
            return (
              <Link
                key={vehicle.id}
                href={`/vehicles/${vehicle.id}`}
                className="group rounded-xl overflow-hidden bg-card border border-border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  {photo ? (
                    <img
                      src={photo}
                      alt={vehicle.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="size-12 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold">{vehicle.name}</h2>
                    {/* Rental-rules hint (#65). Only shows when at least one
                        rule is set — most cars won't have any. */}
                    <RentalRulesBadge
                      rules={{
                        minRentalHours: vehicle.minRentalHours,
                        maxRentalHours: vehicle.maxRentalHours,
                        advanceBookingHours: vehicle.advanceBookingHours,
                      }}
                    />
                  </div>
                  {vehicle.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {vehicle.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-4" />
                      {t('seats', { count: vehicle.seats })}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Settings2 className="size-4" />
                      {vehicle.transmission === 'AUTO' ? t('auto') : t('manual')}
                    </span>
                    {vehicle.fuelType && (
                      <span className="flex items-center gap-1.5">
                        <Fuel className="size-4" />
                        {vehicle.fuelType}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {vehicles.length === 0 && (
          <div className="text-center py-20">
            <Car className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">{t('empty')}</p>
          </div>
        )}
      </div>
    </main>
  )
}
