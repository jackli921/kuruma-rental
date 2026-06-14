import { resolveSlugToRegionId } from '@/vite/regions/region-lookup'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { SearchMap } from '@/vite/search/SearchMap'
import { type ResultView, SearchViewToggle } from '@/vite/search/SearchViewToggle'
import { fetchSearchResults } from '@/vite/search/api'
import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { type StorefrontSearchResultData, fetchStorefronts } from '@/vite/storefronts/api'
import {
  normalizeClassFilter,
  parseSearchRange,
  searchRangeToSeed,
} from '@/vite/storefronts/params'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useTranslations } from 'use-intl'

// All optional (`?: T | undefined`): callers (StorefrontCard, the search form,
// the view toggle) link with only the fields they have, and `| undefined` keeps
// validateSearch's undefined values assignable under exactOptionalPropertyTypes.
// `class` keeps the repeatable string|string[] shape so it round-trips the URL.
// `view` toggles the flat-map list against the slice-5 store grid (#458).
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
// the date prompt). `view=map` runs the cross-operator flat search (#458);
// otherwise the slice-5 storefront grid. Only one of the two fetches runs.
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
    view: search.view ?? 'stores',
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
  component: StorefrontSearchRoute,
})

function StorefrontSearchRoute() {
  const t = useTranslations('search')
  const { locale } = Route.useParams()
  const { from, to, class: classFilter, pickupLocationId, region } = Route.useSearch()
  const data = Route.useLoaderData()

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

        <div className="mb-8 flex justify-end">
          <SearchViewToggle view={data.view} locale={locale} />
        </div>

        {data.view === 'map' ? (
          <SearchMap result={data.flat} />
        ) : (
          <StoreGrid
            result={data.storefronts}
            from={from ?? ''}
            to={to ?? ''}
            classFilter={classFilter}
            pickupLocationId={pickupLocationId}
          />
        )}
      </div>
    </main>
  )
}

/** Slice-5 storefront grid — the default view. Forwards active filters (#499). */
function StoreGrid({
  result,
  from,
  to,
  classFilter,
  pickupLocationId,
}: {
  readonly result: StorefrontSearchResultData | null
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
}) {
  const t = useTranslations('search')

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }
  if (result.storefronts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground/80">{t('emptyTurnaroundHint')}</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {result.storefronts.map((storefront) => (
        <StorefrontCard
          key={storefront.locationId}
          storefront={storefront}
          from={from}
          to={to}
          classFilter={classFilter}
          pickupLocationId={pickupLocationId}
        />
      ))}
    </div>
  )
}
