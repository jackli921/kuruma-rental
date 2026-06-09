import { SearchResultsList } from '@/vite/search/SearchResultsList'
import { type ResultView, SearchViewToggle } from '@/vite/search/SearchViewToggle'
import { fetchSearchResults } from '@/vite/search/api'
import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { type StorefrontSearchResultData, fetchStorefronts } from '@/vite/storefronts/api'
import { normalizeClassFilter, parseSearchRange } from '@/vite/storefronts/params'
import { createFileRoute } from '@tanstack/react-router'
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
  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    pickupLocationId: search.pickupLocationId,
    classes: normalizeClassFilter(search.class),
    view: search.view ?? 'stores',
  }),
  loader: async ({ deps }) => {
    const range = parseSearchRange(deps.from, deps.to)
    const filters = {
      ...(deps.pickupLocationId ? { pickupLocationId: deps.pickupLocationId } : {}),
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
  const { from, to } = Route.useSearch()
  const data = Route.useLoaderData()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>

        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <StorefrontSearchForm defaultFrom={from ?? ''} defaultTo={to ?? ''} />
        </div>

        <div className="mb-8 flex justify-end">
          <SearchViewToggle view={data.view} locale={locale} />
        </div>

        {data.view === 'map' ? (
          <SearchResultsList result={data.flat} />
        ) : (
          <StoreGrid result={data.storefronts} from={from ?? ''} to={to ?? ''} />
        )}
      </div>
    </main>
  )
}

/** Slice-5 storefront grid (unchanged) — the default view. */
function StoreGrid({
  result,
  from,
  to,
}: {
  readonly result: StorefrontSearchResultData | null
  readonly from: string
  readonly to: string
}) {
  const t = useTranslations('search')

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }
  if (result.storefronts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {result.storefronts.map((storefront) => (
        <StorefrontCard key={storefront.locationId} storefront={storefront} from={from} to={to} />
      ))}
    </div>
  )
}
