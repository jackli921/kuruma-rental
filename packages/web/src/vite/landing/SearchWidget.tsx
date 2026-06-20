import { buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { RegionPicker } from '@/vite/regions/RegionPicker'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { DateTimeRangePicker } from '@/vite/search/DateTimeRangePicker'
import type { DateTimeRange } from '@/vite/search/datetime-range'
import { carryForwardFilters, defaultSearchRange } from '@/vite/storefronts/params'
import { persistSearchRange, readPersistedRange } from '@/vite/storefronts/storage'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

// Prefill the picker so a renter can search in one click: restore this session's
// last range if there is one, otherwise the next-hour / +3 day default.
function initialRange(): DateTimeRange {
  return readPersistedRange() ?? defaultSearchRange()
}

export function SearchWidget() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()
  const navigate = useNavigate()
  const { data: regions } = useQuery(regionsQueryOptions())
  // The pickup/return range is controlled by the shared DateTimeRangePicker (#965),
  // seeded once on mount (reads sessionStorage). It emits the same JST wall-clock
  // from/to strings StorefrontSearchForm does, so `/search` parses them directly.
  const [range, setRange] = useState<DateTimeRange>(initialRange)
  // The region anchor (#651 Slice 3): a slug, or null for "search everywhere".
  // Starts empty on the landing page; a chosen region always wins over geolocation.
  const [region, setRegion] = useState<string | null>(null)

  // Persist first so returning to the landing page restores this range; the
  // region slug carries forward so the search route can filter to its subtree.
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    persistSearchRange(range.from, range.to)
    navigate({
      to: '/$locale/search',
      params: { locale },
      search: {
        from: range.from,
        to: range.to,
        ...carryForwardFilters({ region: region ?? undefined }),
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-3 max-w-2xl">
      {/* Region anchor (#651): filters results to a region subtree on the next screen. */}
      <div className="bg-white rounded-2xl shadow-xl p-4">
        <RegionPicker regions={regions ?? []} value={region} onChange={setRegion} />
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex-1 px-2 py-1">
          <Label htmlFor="hero-dates" className="sr-only">
            {t('search.dates')}
          </Label>
          <DateTimeRangePicker id="hero-dates" value={range} onChange={setRange} />
        </div>

        {/* Search button */}
        <button
          type="submit"
          className={cn(
            buttonVariants({ size: 'lg' }),
            'bg-red-600 hover:bg-red-700 text-white rounded-xl px-6 h-12 text-base font-semibold shrink-0',
          )}
        >
          <Search className="size-4 mr-2" />
          {t('search.button')}
        </button>
      </div>
    </form>
  )
}
