import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { fetchStorefronts } from '@/vite/storefronts/api'
import { normalizeClassFilter, parseSearchRange } from '@/vite/storefronts/params'
import { createFileRoute } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useTranslations } from 'use-intl'

// All optional (`?: T | undefined`): callers (StorefrontCard, the search form)
// link with only the fields they have, and `| undefined` keeps validateSearch's
// undefined values assignable under exactOptionalPropertyTypes. `class` keeps the
// repeatable string|string[] shape so it round-trips the URL and normalizes in
// loaderDeps.
interface StorefrontSearch {
  from?: string | undefined
  to?: string | undefined
  pickupLocationId?: string | undefined
  class?: string | string[] | undefined
}

function validateSearch(search: Record<string, unknown>): StorefrontSearch {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const cls = search.class
  return {
    from: str(search.from),
    to: str(search.to),
    pickupLocationId: str(search.pickupLocationId),
    class: Array.isArray(cls) ? cls.filter((c): c is string => typeof c === 'string') : str(cls),
  }
}

// Renter storefront search (#391). Public — no auth. The form pushes wall-clock
// JST date strings; the loader parses them and runs one availability scan via
// the public API. Without a valid range we render the form and a prompt — the
// loader returns `{ result: null }` rather than fetching prematurely.
export const Route = createFileRoute('/$locale/search')({
  validateSearch,
  loaderDeps: ({ search }) => ({
    from: search.from,
    to: search.to,
    pickupLocationId: search.pickupLocationId,
    classes: normalizeClassFilter(search.class),
  }),
  loader: async ({ deps }) => {
    const range = parseSearchRange(deps.from, deps.to)
    if (!range) return { result: null }
    const result = await fetchStorefronts({
      from: range.from,
      to: range.to,
      ...(deps.pickupLocationId ? { pickupLocationId: deps.pickupLocationId } : {}),
      ...(deps.classes.length > 0 ? { classes: deps.classes } : {}),
    })
    return { result }
  },
  component: StorefrontSearchRoute,
})

function StorefrontSearchRoute() {
  const t = useTranslations('search')
  const { from, to } = Route.useSearch()
  const { result } = Route.useLoaderData()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>

        <div className="mb-10 rounded-xl border border-border bg-card p-5">
          <StorefrontSearchForm defaultFrom={from ?? ''} defaultTo={to ?? ''} />
        </div>

        {result === null ? (
          <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
        ) : result.storefronts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="mb-4 size-12 text-muted-foreground/30" />
            <p className="text-lg text-muted-foreground">{t('empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {result.storefronts.map((storefront) => (
              <StorefrontCard
                key={storefront.locationId}
                storefront={storefront}
                from={from ?? ''}
                to={to ?? ''}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
