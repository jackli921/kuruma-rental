import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RegionPicker } from '@/vite/regions/RegionPicker'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { carryForwardFilters, normalizeClassFilter } from '@/vite/storefronts/params'
import { persistSearchRange } from '@/vite/storefronts/storage'
import { ACRISS_CODES } from '@kuruma/shared'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

// The renter-selectable class filter chips: the 8-code MVP ACRISS subset (#388).
// Values are the exact ACRISS codes the search API matches on, so a checked chip
// becomes a `class` URL param the API + `carryForwardFilters` already understand.
// Limitation: a URL-carried code OUTSIDE this subset (operator-custom, #388) has
// no chip, so it is dropped on resubmit; direct navigation still honors it. Add a
// chip source from the live class catalog when operator-custom codes ship.
const CLASS_CODES = Object.keys(ACRISS_CODES) as (keyof typeof ACRISS_CODES)[]

interface StorefrontSearchFormProps {
  /** Wall-clock `datetime-local` strings (JST) to prefill from the URL. */
  readonly defaultFrom?: string
  readonly defaultTo?: string
  /** Active result filters re-emitted so a date refinement preserves them (#499). */
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  /** Current region anchor as a slug (#651 Slice 3), prefilled into the picker. */
  readonly region?: string | undefined
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
}: StorefrontSearchFormProps) {
  const t = useTranslations('search')
  const tAcriss = useTranslations('acriss')
  const locale = useLocale()
  const navigate = useNavigate()
  const { data: regions } = useQuery(regionsQueryOptions())
  // The region anchor is the form's one piece of controlled state; the date inputs
  // stay uncontrolled to dodge the #392 pre-hydration reconcile flake (§6 caveat).
  const [selectedRegion, setSelectedRegion] = useState<string | null>(region ?? null)

  const selectedClasses = normalizeClassFilter(classFilter)

  // Read the range from the FORM (DOM), not React state. Uncontrolled inputs
  // survive a pre-hydration fill on slow CI runners; a controlled form would
  // reconcile them back to empty on hydrate and block submit (#392 E2E flake).
  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const from = String(data.get('from') ?? '')
    const to = String(data.get('to') ?? '')
    // Repeatable `class` checkboxes → an ACRISS code array the API filters on.
    const classes = data.getAll('class').map(String)
    // Remember the range so the landing hero restores a refinement made here.
    persistSearchRange(from, to)
    navigate({
      to: '/$locale/search',
      params: { locale },
      // The chips SET the class filter; pickup-location + region carry forward so
      // refining the search doesn't reset them (#499, #651).
      search: {
        from,
        to,
        ...carryForwardFilters({
          class: classes,
          pickupLocationId,
          region: selectedRegion ?? undefined,
        }),
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <RegionPicker regions={regions ?? []} value={selectedRegion} onChange={setSelectedRegion} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="from">{t('fromLabel')}</Label>
          <Input id="from" name="from" type="datetime-local" defaultValue={defaultFrom} required />
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="to">{t('toLabel')}</Label>
          <Input id="to" name="to" type="datetime-local" defaultValue={defaultTo} required />
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
