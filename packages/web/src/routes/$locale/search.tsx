import { resolveRegionAnchor, resolveSlugToRegionId } from '@/vite/regions/region-lookup'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { SearchMap } from '@/vite/search/SearchMap'
import { type ResultView, SearchViewToggle } from '@/vite/search/SearchViewToggle'
import { fetchSearchResults } from '@/vite/search/api'
import { isSearchMapEnabled, resolveResultView } from '@/vite/search/flags'
import { StoreGrid } from '@/vite/storefronts/StoreGrid'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { fetchStorefronts } from '@/vite/storefronts/api'
import {
  normalizeClassFilter,
  parseSearchRange,
  searchRangeToSeed,
} from '@/vite/storefronts/params'
import { useQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// All optional (`?: T | undefined`): callers (StorefrontCard, the search form,
// the view toggle) link with only the fields they have, and `| undefined` keeps
// validateSearch's undefined values assignable under exactOptionalPropertyTypes.
// `class` keeps the repeatable string|string[] shape so it round-trips the URL.
// `view` toggles the flat-map list against the slice-5 store grid (#458), but only
// when the search map flag is enabled (#885) — otherwise it's always the grid.
interface StorefrontSearch {
  from?: string | undefined
  to?: string | undefined
  pickupLocationId?: string | undefined
  /** #651 Slice 3: region anchor as its stable slug (`?region=namba`). */
  region?: string | undefined
  class?: string | string[] | undefined
  view?: ResultView | undefined
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
    view: search.view === 'map' ? 'map' : search.view === 'stores' ? 'stores' : undefined,
  }
}

// Renter search (#391, #458). Public — no auth. The form pushes wall-clock JST
// date strings; without a valid range the loader returns null (the views render
// the date prompt). `view=map` runs the cross-operator flat search (#458) when the
// map flag is on (#885); otherwise the storefront grid. Only one fetch runs.
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
    // Map gated off (beta) → a stale ?view=map link collapses to the store list so
    // the loader never fetches flat results with no map to render them (#885 Task 0).
    view: resolveResultView(search.view, isSearchMapEnabled()),
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

    if (deps.view === 'map') {
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
  const router = useRouter()
  return (
    <main className="flex-1 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}

export function StorefrontSearchRoute() {
  const t = useTranslations('search')
  const { locale } = Route.useParams()
  const { from, to, class: classFilter, pickupLocationId, region } = Route.useSearch()
  const data = Route.useLoaderData()
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
          />
        </div>

        {/* The Stores|Map data-mode toggle is a map-only affordance — hidden in
            beta where the map is gated off, so search is a pure store list (#885). */}
        {isSearchMapEnabled() && (
          <div className="mb-8 flex justify-end">
            <SearchViewToggle view={data.view} locale={locale} />
          </div>
        )}

        {/* Defense in depth: the toggle is hidden and the loader collapses `view`
            to 'stores' when the map is off, but gate the render too so the premium
            map can never mount by accident (#885) — the no-leak guarantee lives at
            the render site, not only in the loader. SearchMap still ships in the
            bundle (static import, unreachable in beta); lazy-load only if a build
            that strips it is ever required. */}
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
          <StoreGrid
            result={data.storefronts}
            from={from ?? ''}
            to={to ?? ''}
            classFilter={classFilter}
            pickupLocationId={pickupLocationId}
            region={region}
          />
        )}
      </div>
    </main>
  )
}
