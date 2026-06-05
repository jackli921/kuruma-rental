import {
  StorefrontCard,
  StorefrontSearchForm,
  fetchStorefronts,
  normalizeClassFilter,
  parseSearchRange,
} from '@/modules/storefronts'
import { Search } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

interface SearchPageProps {
  searchParams: Promise<{
    from?: string
    to?: string
    pickupLocationId?: string
    class?: string | string[]
  }>
}

// Renter storefront search (#391). Public — no auth (classifyRoute treats
// /search as public). The form pushes wall-clock JST date strings; we parse
// them server-side and run one availability scan via the public API. Without a
// valid range we render the form and a prompt — no premature fetch.
export default async function StorefrontSearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams
  const t = await getTranslations('search')

  const range = parseSearchRange(sp.from, sp.to)
  const classes = normalizeClassFilter(sp.class)

  const result = range
    ? await fetchStorefronts({
        from: range.from,
        to: range.to,
        ...(sp.pickupLocationId ? { pickupLocationId: sp.pickupLocationId } : {}),
        ...(classes.length > 0 ? { classes } : {}),
      })
    : null

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>

        <div className="mb-10 rounded-xl border border-border bg-card p-5">
          <StorefrontSearchForm defaultFrom={sp.from ?? ''} defaultTo={sp.to ?? ''} />
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
                from={sp.from ?? ''}
                to={sp.to ?? ''}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
