import { auth } from '@/auth'
import {
  fetchStorefrontDetail,
  fetchStorefrontInsuranceOptions,
  parseSearchRange,
} from '@/modules/storefronts'
import { getLocale, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { BookingVehicleSummary } from './BookingVehicleSummary'
import { VehicleBookingForm } from './VehicleBookingForm'

interface NewBookingPageProps {
  searchParams: Promise<{ vehicleId?: string; locationId?: string; from?: string; to?: string }>
}

// Slice 6 (#392): renter booking flow. The entry point is a storefront vehicle
// card, which links here with ?vehicleId&locationId&from&to. Middleware gates
// /bookings/*, so the caller is signed in. We re-read the storefront detail for
// the date range: this both fetches the renter-safe vehicle projection and
// re-confirms availability (a car booked since browsing simply won't be listed).
export default async function NewBookingPage({ searchParams }: NewBookingPageProps) {
  const { vehicleId, locationId, from, to } = await searchParams
  const [t, locale, session] = await Promise.all([
    getTranslations('bookings.new'),
    getLocale(),
    auth(),
  ])

  if (!session?.user?.id) {
    redirect(`/${locale}/login`)
  }

  const range = parseSearchRange(from, to)
  if (!vehicleId || !locationId || !range) {
    notFound()
  }

  const [detail, insuranceOptions] = await Promise.all([
    fetchStorefrontDetail(locationId, { from: range.from, to: range.to }),
    fetchStorefrontInsuranceOptions(locationId),
  ])
  const vehicle = detail?.vehicles.find((v) => v.id === vehicleId)
  if (!detail || !vehicle) {
    notFound()
  }

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <BookingVehicleSummary
          vehicle={vehicle}
          storefront={detail.storefront}
          from={range.from}
          to={range.to}
        />
        <VehicleBookingForm
          vehicleId={vehicle.id}
          pickupLocationId={detail.storefront.locationId}
          startAtIso={range.from.toISOString()}
          endAtIso={range.to.toISOString()}
          insuranceOptions={insuranceOptions ?? []}
        />
      </div>
    </main>
  )
}
