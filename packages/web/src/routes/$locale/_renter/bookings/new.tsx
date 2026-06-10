import { ReservationWizard } from '@/vite/reservation/ReservationWizard'
import { fetchAddOns, fetchInsuranceOptions } from '@/vite/reservation/api'
import { fetchStorefrontDetail } from '@/vite/storefronts/api'
import { parseSearchRange } from '@/vite/storefronts/params'
import { createFileRoute, redirect } from '@tanstack/react-router'

interface NewBookingSearch {
  vehicleId?: string | undefined
  locationId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

function validateSearch(search: Record<string, unknown>): NewBookingSearch {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return {
    vehicleId: str(search.vehicleId),
    locationId: str(search.locationId),
    from: str(search.from),
    to: str(search.to),
  }
}

// Reservation wizard route (#460), gated by `_renter` (login required to book).
// The CTA on a storefront's available-vehicle card carries vehicleId + locationId
// + the JST range here. The loader re-validates availability (the car may have
// been taken since the search) and prefetches the operator's add-ons + insurance;
// a missing range/vehicle bounces the renter back to search or the storefront.
export const Route = createFileRoute('/$locale/_renter/bookings/new')({
  validateSearch,
  loaderDeps: ({ search }) => ({
    vehicleId: search.vehicleId,
    locationId: search.locationId,
    from: search.from,
    to: search.to,
  }),
  loader: async ({ params, deps }) => {
    const range = parseSearchRange(deps.from, deps.to)
    if (!range || !deps.locationId || !deps.vehicleId) {
      throw redirect({ to: '/$locale/search', params: { locale: params.locale } })
    }

    const detail = await fetchStorefrontDetail(deps.locationId, { from: range.from, to: range.to })
    if (!detail) throw redirect({ to: '/$locale/search', params: { locale: params.locale } })

    const vehicle = detail.vehicles.find((v) => v.id === deps.vehicleId)
    if (!vehicle) {
      // The car is no longer available for these dates — let the renter pick another.
      throw redirect({
        to: '/$locale/storefronts/$locationId',
        params: { locale: params.locale, locationId: deps.locationId },
        search: { from: deps.from, to: deps.to },
      })
    }

    const [addOns, insuranceOptions] = await Promise.all([
      fetchAddOns(deps.locationId),
      fetchInsuranceOptions(deps.locationId),
    ])
    return { vehicle, addOns, insuranceOptions, from: range.from, to: range.to }
  },
  component: NewBookingRoute,
})

function NewBookingRoute() {
  const { locale } = Route.useParams()
  const { vehicle, addOns, insuranceOptions, from, to } = Route.useLoaderData()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <ReservationWizard
        locale={locale}
        vehicle={vehicle}
        addOns={addOns}
        insuranceOptions={insuranceOptions}
        from={from}
        to={to}
      />
    </main>
  )
}
