import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RegionPicker } from '@/vite/regions/RegionPicker'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { DateTimeRangePicker } from '@/vite/search/DateTimeRangePicker'
import type { DateTimeRange } from '@/vite/search/datetime-range'
import {
  carryForwardFilters,
  defaultSearchRange,
  normalizeClassFilter,
} from '@/vite/storefronts/params'
import type { SortOption } from '@/vite/storefronts/sort'
import { persistSearchRange } from '@/vite/storefronts/storage'
import { ACRISS_CODES } from '@kuruma/shared'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

// The renter-selectable class filter chips: the 8-code MVP ACRISS subset (#388).
// Values are the exact ACRISS codes the search API matches on, so a checked chip
// becomes a `class` URL param the API + `carryForwardFilters` already understand.
// A URL-carried code OUTSIDE this subset (operator-custom, #388) has no chip, so
// it can't be re-checked; handleSubmit preserves such codes explicitly (#1291) so
// re-submitting the form no longer silently drops them.
const CLASS_CODES = Object.keys(ACRISS_CODES) as (keyof typeof ACRISS_CODES)[]
const CHIP_CODES: ReadonlySet<string> = new Set(CLASS_CODES)

interface StorefrontSearchFormProps {
  /** Wall-clock `datetime-local` strings (JST) to prefill from the URL. */
  readonly defaultFrom?: string
  readonly defaultTo?: string
  /** Active result filters re-emitted so a date refinement preserves them (#499). */
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  /** Current region anchor as a slug (#651 Slice 3), prefilled into the picker. */
  readonly region?: string | undefined
  /** Result ordering + price cap, re-emitted so a date/class refinement keeps them (#1291). */
  readonly sort?: SortOption | undefined
  readonly priceMax?: number | undefined
}

/**
 * Renter date-range search form (#391). Navigates to the locale-scoped search
 * route with the chosen pickup/return as `from`/`to` search params; the route
 * loader interprets them as JST (the same wall-clock convention as the booking
 * form) before hitting the API. MVP defaults pickup = return location, so no
 * location control ships here (§3).
 */
export function StorefrontSearchForm({
  defaultFrom = '',
  defaultTo = '',
  classFilter,
  pickupLocationId,
  region,
  sort,
  priceMax,
}: StorefrontSearchFormProps) {
  const t = useTranslations('search')
  const tAcriss = useTranslations('acriss')
  const locale = useLocale()
  const navigate = useNavigate()
  const { data: regions } = useQuery(regionsQueryOptions())
  const [selectedRegion, setSelectedRegion] = useState<string | null>(region ?? null)
  // The pickup/return range is controlled (#965). Seeded from the URL prefill, or
  // the next-hour default when this form mounts without one. The web is a pure
  // Vite SPA now, so the old #392 pre-hydration reconcile flake no longer applies.
  const [range, setRange] = useState<DateTimeRange | null>(() =>
    defaultFrom && defaultTo ? { from: defaultFrom, to: defaultTo } : defaultSearchRange(),
  )

  const selectedClasses = normalizeClassFilter(classFilter)

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (!range) return
    // Repeatable `class` checkboxes → an ACRISS code array the API filters on.
    const checked = new FormData(e.currentTarget).getAll('class').map(String)
    // Operator-custom codes have no chip, so they can't be checked; carry the
    // ones already in the filter forward so a re-submit doesn't drop them (#1291).
    const preserved = selectedClasses.filter((code) => !CHIP_CODES.has(code))
    const classes = [...checked, ...preserved]
    // Remember the range so the landing hero restores a refinement made here.
    persistSearchRange(range.from, range.to)
    navigate({
      to: '/$locale/search',
      params: { locale },
      // The chips SET the class filter; pickup-location + region carry forward so
      // refining the search doesn't reset them (#499, #651).
      search: {
        from: range.from,
        to: range.to,
        ...carryForwardFilters({
          class: classes,
          pickupLocationId,
          region: selectedRegion ?? undefined,
        }),
        // Preserve the current ordering + price cap across a date/class refinement.
        ...(sort ? { sort } : {}),
        ...(priceMax != null ? { priceMax } : {}),
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <RegionPicker regions={regions ?? []} value={selectedRegion} onChange={setSelectedRegion} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="datetime-range">{t('picker.label')}</Label>
          <DateTimeRangePicker id="datetime-range" value={range} onChange={setRange} />
        </div>
        <Button type="submit" className="sm:w-auto">
          {t('submit')}
        </Button>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('classFilterLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {CLASS_CODES.map((code) => (
            <label key={code} className="cursor-pointer">
              <input
                type="checkbox"
                name="class"
                value={code}
                defaultChecked={selectedClasses.includes(code)}
                className="peer sr-only"
              />
              <span className="inline-flex items-center rounded-full border border-input bg-background px-3 py-1 text-sm transition-colors hover:bg-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                {tAcriss(code)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  )
}
