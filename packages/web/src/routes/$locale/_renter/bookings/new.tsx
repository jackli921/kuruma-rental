import { DEFAULT_LOCALE, isLocale } from '@/vite/i18n/locale'
import { ReservationWizard } from '@/vite/reservation/ReservationWizard'
import { fetchAddOns, fetchInsuranceOptions } from '@/vite/reservation/api'
import type { ReservationSubject } from '@/vite/reservation/subject'
import { fetchStorefrontDetail } from '@/vite/storefronts/api'
import { carryForwardFilters, parseSearchRange } from '@/vite/storefronts/params'
import { createFileRoute, redirect } from '@tanstack/react-router'

interface NewBookingSearch {
  vehicleId?: string | undefined
  // #464: a class-combo deal books a CLASS, not a specific car — the storefront's
  // ClassOfferingCard links here with classId (and no vehicleId). The loader
  // resolves it to a CLASS_COMBO subject and the wizard books the class off its
  // rate plan (the operator assigns the exact car before pickup).
  classId?: string | undefined
  locationId?: string | undefined
  from?: string | undefined
  to?: string | undefined
  // Carried through (not used by the booking fetch) so the wizard back link and
  // the availability-bounce redirects restore the active search filters (#1291).
  class?: string | string[] | undefined
  pickupLocationId?: string | undefined
  region?: string | undefined
}

function validateSearch(search: Record<string, unknown>): NewBookingSearch {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const cls = search.class
  return {
    vehicleId: str(search.vehicleId),
    classId: str(search.classId),
    locationId: str(search.locationId),
    from: str(search.from),
    to: str(search.to),
    class: Array.isArray(cls) ? cls.filter((c): c is string => typeof c === 'string') : str(cls),
    pickupLocationId: str(search.pickupLocationId),
    region: str(search.region),
  }
}

// Reservation wizard route (#460), gated by `_renter` (login required to book).
// The CTA on a storefront's available-vehicle card carries vehicleId + locationId
// + the JST range + the active search filters here. The loader re-validates
// availability (the car may have been taken since the search) and prefetches the
// operator's add-ons + insurance; a missing range/vehicle bounces the renter back
// to search or the storefront, preserving those filters (#1291).
export const Route = createFileRoute('/$locale/_renter/bookings/new')({
  validateSearch,
  loaderDeps: ({ search }) => ({
    vehicleId: search.vehicleId,
    classId: search.classId,
    locationId: search.locationId,
    from: search.from,
    to: search.to,
    class: search.class,
    pickupLocationId: search.pickupLocationId,
    region: search.region,
  }),
  loader: async ({ params, deps }) => {
    const filters = carryForwardFilters({
      class: deps.class,
      pickupLocationId: deps.pickupLocationId,
      region: deps.region,
    })
    const range = parseSearchRange(deps.from, deps.to)
    // A class-combo entry (#464) carries a classId and no vehicleId, so either id
    // is enough — a classId-only entry must survive the guard to resolve below.
    if (!range || !deps.locationId || (!deps.vehicleId && !deps.classId)) {
      throw redirect({ to: '/$locale/search', params: { locale: params.locale }, search: filters })
    }

    const detail = await fetchStorefrontDetail(deps.locationId, { from: range.from, to: range.to })
    if (!detail)
      throw redirect({ to: '/$locale/search', params: { locale: params.locale }, search: filters })

    // The subject is no longer offered for these dates (a car taken since search,
    // or a class the storefront no longer lists): let the renter pick another,
    // keeping their dates and filters so they don't restart the search (#1291).
    const bounceToStorefront = redirect({
      to: '/$locale/storefronts/$locationId',
      params: { locale: params.locale, locationId: deps.locationId },
      search: { from: deps.from, to: deps.to, ...filters },
    })

    // #464: resolve a vehicle-OR-class subject. classId books a CLASS (the operator
    // assigns the exact car before pickup); vehicleId books that concrete car.
    let subject: ReservationSubject
    if (deps.classId) {
      const offering = detail.classOfferings.find((o) => o.classId === deps.classId)
      if (!offering) throw bounceToStorefront
      subject = { kind: 'CLASS_COMBO', offering }
    } else {
      const vehicle = detail.vehicles.find((v) => v.id === deps.vehicleId)
      if (!vehicle) throw bounceToStorefront
      subject = { kind: 'SPECIFIC', vehicle }
    }

    // The $locale layout already 404s an invalid param; narrow it to satisfy the
    // typed client (fall back to the default defensively). Add-on + insurance names
    // resolve to this locale server-side; a locale change re-runs the loader via the path.
    const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE
    const [addOns, insuranceOptions] = await Promise.all([
      fetchAddOns(deps.locationId, locale),
      fetchInsuranceOptions(deps.locationId, locale),
    ])
    return {
      subject,
      locationId: deps.locationId,
      addOns,
      insuranceOptions,
      from: range.from,
      to: range.to,
      classFilter: deps.class,
      pickupLocationId: deps.pickupLocationId,
      region: deps.region,
    }
  },
  component: NewBookingRoute,
})

function NewBookingRoute() {
  const { locale } = Route.useParams()
  const {
    subject,
    locationId,
    addOns,
    insuranceOptions,
    from,
    to,
    classFilter,
    pickupLocationId,
    region,
  } = Route.useLoaderData()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <ReservationWizard
        locale={locale}
        subject={subject}
        locationId={locationId}
        addOns={addOns}
        insuranceOptions={insuranceOptions}
        from={from}
        to={to}
        classFilter={classFilter}
        pickupLocationId={pickupLocationId}
        region={region}
      />
    </main>
  )
}
