import { RouteRetryError } from '@/vite/RouteRetryError'
import { resolveRegionAnchor, resolveSlugToRegionId } from '@/vite/regions/region-lookup'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { SearchMap } from '@/vite/search/SearchMap'
import { fetchSearchResults } from '@/vite/search/api'
import { isSearchMapEnabled } from '@/vite/search/flags'
import { SearchResultControls } from '@/vite/storefronts/SearchResultControls'
import { StoreGrid } from '@/vite/storefronts/StoreGrid'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { fetchStorefronts } from '@/vite/storefronts/api'
import {
  normalizeClassFilter,
  parseSearchRange,
  searchRangeToSeed,
} from '@/vite/storefronts/params'
import { type SortOption, parsePriceMax, parseSort } from '@/vite/storefronts/sort'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// All optional (`?: T | undefined`): callers (StorefrontCard, the search form)
// link with only the fields they have, and `| undefined` keeps validateSearch's
// undefined values assignable under exactOptionalPropertyTypes. `class` keeps the
// repeatable string|string[] shape so it round-trips the URL. There is no `?view`
// param since #885 slice 3b — the results view is the unified car-first map+list
// (or the store grid when the map flag is off), chosen by `isSearchMapEnabled()`,
// not the URL. A stale `?view=…` link is silently dropped here and self-heals.
interface StorefrontSearch {
  from?: string | undefined
  to?: string | undefined
  pickupLocationId?: string | undefined
  /** #651 Slice 3: region anchor as its stable slug (`?region=namba`). */
  region?: string | undefined
  class?: string | string[] | undefined
  /** #1291: result ordering + daily-price cap, applied client-side per page. */
  sort?: SortOption | undefined
  priceMax?: number | undefined
}

function validateSearch(search: Record<string, unknown>): StorefrontSearch {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const cls = search.class
  return {
    from: str(search.from),
    to: str(search.to),
    pickupLocationId: str(search.pickupLocationId),
    region: str(search.region),
    class: Array.isArray(cls) ? cls.filter((c): c is string => typeof c === 'string') : str(cls),
    sort: parseSort(search.sort),
    priceMax: parsePriceMax(search.priceMax),
  }
}

// Renter search (#391, #458). Public — no auth. The form pushes wall-clock JST
// date strings; without a valid range the loader returns null (the views render
// the date prompt). The map flag (#885 slice 3b) picks the data shape: ON → the
// cross-operator flat car search behind the unified map+list; OFF → the storefront
// grid (beta MVP). Only one fetch runs.
export const Route = createFileRoute('/$locale/search')({
  validateSearch,
  // Seed a default range (next JST hour -> +3 days) when the renter arrives
  // without one, so the search auto-runs results instead of showing the date
  // prompt. `replace` keeps the empty entry out of history for clean back-nav.
  beforeLoad: ({ search, params }) => {
    const seed = searchRangeToSeed(search)
    if (seed) {
      throw redirect({
        to: '/$locale/search',
        params: { locale: params.locale },
        search: { ...search, ...seed },
        replace: true,
      })
    }
  },
  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    pickupLocationId: search.pickupLocationId,
    region: search.region,
    classes: normalizeClassFilter(search.class),
  }),
  loader: async ({ deps, context }) => {
    const range = parseSearchRange(deps.from, deps.to)
    // Resolve the URL region slug (#651 Decision 6) to its stable id against the
    // edge-cached region list, then filter both searches to that region's subtree.
    const regionId = deps.region
      ? resolveSlugToRegionId(
          await context.queryClient.ensureQueryData(regionsQueryOptions()),
          deps.region,
        )
      : undefined
    const filters = {
      ...(deps.pickupLocationId ? { pickupLocationId: deps.pickupLocationId } : {}),
      ...(regionId ? { regionId } : {}),
      ...(deps.classes.length > 0 ? { classes: deps.classes } : {}),
    }

    // The map flag is the single source of truth for the results view (#885 3b).
    // `view` is kept as an internal discriminant on the returned data (flat vs
    // storefronts narrowing) — it is no longer a URL param.
    if (isSearchMapEnabled()) {
      const flat = range
        ? await fetchSearchResults({ from: range.from, to: range.to, ...filters })
        : null
      return { view: 'map' as const, flat, storefronts: null }
    }

    const storefronts = range
      ? await fetchStorefronts({ from: range.from, to: range.to, ...filters })
      : null
    return { view: 'stores' as const, storefronts, flat: null }
  },
  errorComponent: SearchError,
  component: StorefrontSearchRoute,
})

// A loader failure (the GET /regions slug resolution or either storefront fetch
// can throw) degrades in-page here instead of escalating to the app-root Sentry
// boundary — this is the public search front door, so it gets the same retry UX
// as every other loader-bearing route (#841 review).
function SearchError(_props: ErrorComponentProps) {
  const t = useTranslations('search')
  return (
    <main className="flex-1 px-4 py-20 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-7xl text-center"
      />
    </main>
  )
}

export function StorefrontSearchRoute() {
  const t = useTranslations('search')
  const { locale } = Route.useParams()
  const {
    from,
    to,
    class: classFilter,
    pickupLocationId,
    region,
    sort,
    priceMax,
  } = Route.useSearch()
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()
  // Sort/price update only their own params via a functional updater, so dates,
  // class, region and pickup are all preserved (#1291). `nearest` is the default,
  // so it drops the param to keep the URL clean.
  const handleSortChange = (next: SortOption): void => {
    navigate({ search: (prev) => ({ ...prev, sort: next === 'nearest' ? undefined : next }) })
  }
  const handlePriceMaxChange = (next: number | undefined): void => {
    navigate({ search: (prev) => ({ ...prev, priceMax: next }) })
  }
  // Resolve the chosen region's center once from the edge-cached list (already
  // ensured by the loader) so the map can focus on the picked area (#840). The grid
  // resolves the same anchor internally for ranking — both share resolveRegionAnchor.
  const { data: regions } = useQuery(regionsQueryOptions())
  const regionAnchor = resolveRegionAnchor(regions, region)
  const mapAnchor: [number, number] | null = regionAnchor
    ? [regionAnchor.latitude, regionAnchor.longitude]
    : null

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>

        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          {/* Key on the URL range so back/forward remounts the uncontrolled
              inputs with the restored values instead of keeping stale ones. */}
          <StorefrontSearchForm
            key={`${from ?? ''}|${to ?? ''}`}
            defaultFrom={from ?? ''}
            defaultTo={to ?? ''}
            classFilter={classFilter}
            pickupLocationId={pickupLocationId}
            region={region}
            sort={sort}
            priceMax={priceMax}
          />
        </div>

        {/* The map flag is the single source of truth for the results view since
            #885 slice 3b: ON → the unified car-first map+list default (its own
            Hide/Show-map presentation toggle lives inside SearchMapList); OFF →
            the store grid (beta MVP). The render-site flag guard is belt-and-
            suspenders alongside the loader so the premium map can never mount by
            accident even if a future loader change leaked `view:'map'` through.
            SearchMap still ships in the bundle (static import, unreachable in
            beta); lazy-load only if a build that strips it is ever required. */}
        {isSearchMapEnabled() && data.view === 'map' ? (
          <SearchMap
            result={data.flat}
            anchor={mapAnchor}
            regions={regions ?? []}
            geoAnchor={regionAnchor}
            locale={locale}
            from={from ?? ''}
            to={to ?? ''}
            classFilter={classFilter}
            pickupLocationId={pickupLocationId}
            region={region}
          />
        ) : (
          <>
            <div className="mb-6">
              <SearchResultControls
                sort={sort}
                priceMax={priceMax}
                onSortChange={handleSortChange}
                onPriceMaxChange={handlePriceMaxChange}
              />
            </div>
            <StoreGrid
              result={data.storefronts}
              from={from ?? ''}
              to={to ?? ''}
              classFilter={classFilter}
              pickupLocationId={pickupLocationId}
              region={region}
              sort={sort}
              priceMax={priceMax}
            />
          </>
        )}
      </div>
    </main>
  )
}
