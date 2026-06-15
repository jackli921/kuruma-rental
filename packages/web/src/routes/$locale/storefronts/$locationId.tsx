import { StorefrontDetailView } from '@/vite/storefronts/StorefrontDetailView'
import { fetchStorefrontDetail } from '@/vite/storefronts/api'
import {
  carryForwardFilters,
  normalizeClassFilter,
  parseSearchRange,
} from '@/vite/storefronts/params'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

interface StorefrontDetailSearch {
  from?: string | undefined
  to?: string | undefined
  class?: string | string[] | undefined
  // Carried through (not used by the detail fetch) so the back link and the
  // invalid-range redirect can restore the active search filters (#499, #840).
  pickupLocationId?: string | undefined
  region?: string | undefined
}

function validateSearch(search: Record<string, unknown>): StorefrontDetailSearch {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const cls = search.class
  return {
    from: str(search.from),
    to: str(search.to),
    class: Array.isArray(cls) ? cls.filter((c): c is string => typeof c === 'string') : str(cls),
    pickupLocationId: str(search.pickupLocationId),
    region: str(search.region),
  }
}

// Storefront drill-down (#391). Public — anonymous renters see the available
// cars at one store for their date range. A direct link without a usable range
// can't compute availability, so we bounce back to /search to pick dates. An
// unknown/archived store is a 404 (notFound); a known-but-full store is a 200
// with an empty vehicles array rendered as the empty state.
export const Route = createFileRoute('/$locale/storefronts/$locationId')({
  validateSearch,
  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    classes: normalizeClassFilter(search.class),
    pickupLocationId: search.pickupLocationId,
    region: search.region,
  }),
  loader: async ({ params, deps }) => {
    const range = parseSearchRange(deps.from, deps.to)
    if (!range)
      throw redirect({
        to: '/$locale/search',
        params: { locale: params.locale },
        // Range is invalid, so from/to are dropped — but keep the active filters
        // so the renter re-picks dates without losing their class/location (#499).
        search: carryForwardFilters({
          class: deps.classes,
          pickupLocationId: deps.pickupLocationId,
          region: deps.region,
        }),
      })
    const detail = await fetchStorefrontDetail(params.locationId, {
      from: range.from,
      to: range.to,
      ...(deps.classes.length > 0 ? { classes: deps.classes } : {}),
    })
    if (!detail) throw notFound()
    return detail
  },
  component: StorefrontDetailRoute,
})

function StorefrontDetailRoute() {
  const detail = Route.useLoaderData()
  const { from, to, class: classFilter, pickupLocationId, region } = Route.useSearch()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <StorefrontDetailView
        detail={detail}
        from={from ?? ''}
        to={to ?? ''}
        classFilter={classFilter}
        pickupLocationId={pickupLocationId}
        region={region}
      />
    </main>
  )
}
