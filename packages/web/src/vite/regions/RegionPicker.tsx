import { Label } from '@/components/ui/label'
import { nearestAssignableRegion } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import { useEffect, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { LocationCombobox } from './LocationCombobox'
import { regionName } from './region-locale'
import { regionChain } from './region-lookup'

// Tourist quick-picks (#651 §6). Slugs are stable contracts; a slug absent from the
// live taxonomy is skipped. The level mix (Kyoto = prefecture) is intentional — the
// renter may anchor at any level, since the backend filters by region subtree.
const QUICK_PICK_SLUGS = ['namba', 'umeda', 'kix', 'kyoto'] as const

// Cap the geolocation prompt so a hung permission dialog (some in-app browsers never
// resolve or reject) can't leave the "Near me" button stuck on "Locating…" forever.
const GEO_TIMEOUT_MS = 10_000
const GEO_MAX_AGE_MS = 5 * 60_000

export interface RegionPickerProps {
  regions: readonly RegionNode[]
  /** The selected region as its stable slug (the URL contract — #651 Decision 6), or null. */
  value: string | null
  onChange: (slug: string | null) => void
  disabled?: boolean
}

/**
 * Renter region anchor (#651 Slice 3): a prefecture -> city -> area cascade selectable
 * at ANY level (each level emits that node's slug), plus tourist quick-pick chips and
 * an opt-in "Near me". Controlled by a single slug `value`; geolocation is never the
 * default anchor, so a chosen region always wins (§6 precedence). Empty at a deeper
 * select means "all of the parent" and emits the parent's slug.
 */
export function RegionPicker({ regions, value, onChange, disabled }: RegionPickerProps) {
  const t = useTranslations('regionPicker')
  const locale = useLocale()
  const ids = useId()
  const [locating, setLocating] = useState(false)

  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions])
  const bySlug = useMemo(() => new Map(regions.map((r) => [r.slug, r])), [regions])

  // `value` is a slug; resolve to the id lineage so the three selects prefill at any level.
  const selectedId = value !== null ? (bySlug.get(value)?.id ?? null) : null
  const chain = regionChain(regions, selectedId)

  // A slug-less node is non-addressable (the picker emits slugs — #651 Decision 6), so
  // selecting one would map to null = "Anywhere" and silently clear. Exclude it here so
  // an unaddressable node is never offered as an option (review H2).
  const prefectures = regions.filter(
    (r) => r.type === 'PREFECTURE' && r.status === 'ACTIVE' && r.slug !== null,
  )
  const cities = regions.filter(
    (r) =>
      r.type === 'CITY' &&
      r.parentId === chain.prefecture?.id &&
      r.status === 'ACTIVE' &&
      r.slug !== null,
  )
  const areas = regions.filter(
    (r) =>
      r.type === 'AREA' &&
      r.parentId === chain.city?.id &&
      r.assignable &&
      r.status === 'ACTIVE' &&
      r.slug !== null,
  )

  const slugOf = (id: string): string | null => byId.get(id)?.slug ?? null
  // A chosen id emits its slug; clearing a select ("") emits the parent's slug (filter
  // the whole parent), or null at the top level (no region — the full list).
  const emit = (id: string, parent: RegionNode | null) => {
    if (id !== '') {
      onChange(slugOf(id))
      return
    }
    onChange(parent !== null ? slugOf(parent.id) : null)
  }

  const quickPicks = QUICK_PICK_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (r): r is RegionNode => r !== undefined,
  )

  // Dev-only: a renamed/removed quick-pick slug otherwise vanishes as a silent missing
  // chip. Surface it so it's caught before shipping (review L1).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const missing = QUICK_PICK_SLUGS.filter((slug) => !bySlug.has(slug))
    if (missing.length > 0) {
      console.warn(`RegionPicker: quick-pick slug(s) not in taxonomy: ${missing.join(', ')}`)
    }
  }, [bySlug])

  const handleNearMe = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onChange(null)
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const nearest = nearestAssignableRegion(regions, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        })
        onChange(nearest?.slug ?? null)
      },
      () => {
        // Denied / unavailable / timed out: a stale device point must never override a
        // chosen area — fall back to the full list (§6).
        setLocating(false)
        onChange(null)
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: GEO_MAX_AGE_MS },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${ids}-prefecture`}>{t('prefecture')}</Label>
          <LocationCombobox
            id={`${ids}-prefecture`}
            regions={prefectures}
            value={chain.prefecture?.id ?? ''}
            placeholder={t('anywhere')}
            disabled={disabled}
            onChange={(id) => emit(id, null)}
          />
        </div>
        <div>
          <Label htmlFor={`${ids}-city`}>{t('city')}</Label>
          <LocationCombobox
            id={`${ids}-city`}
            regions={cities}
            value={chain.city?.id ?? ''}
            placeholder={t('allCities')}
            disabled={disabled || chain.prefecture === null}
            onChange={(id) => emit(id, chain.prefecture)}
          />
        </div>
        <div>
          <Label htmlFor={`${ids}-area`}>{t('area')}</Label>
          <LocationCombobox
            id={`${ids}-area`}
            regions={areas}
            value={chain.area?.id ?? ''}
            placeholder={t('allAreas')}
            disabled={disabled || chain.city === null}
            onChange={(id) => emit(id, chain.city)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="sr-only">{t('popular')}</span>
        {quickPicks.map((r) => {
          const active = value === r.slug
          return (
            <button
              key={r.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(r.slug)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {regionName(r, locale)}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled || locating}
          onClick={handleNearMe}
          className="rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {locating ? t('locating') : t('nearMe')}
        </button>
      </div>
    </div>
  )
}
