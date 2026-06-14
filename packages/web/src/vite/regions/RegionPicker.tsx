import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { nearestAssignableRegion } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import { useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { regionChain } from './region-lookup'

// Tourist quick-picks (#651 §6). Slugs are stable contracts; a slug absent from the
// live taxonomy is skipped. The level mix (Kyoto = prefecture) is intentional — the
// renter may anchor at any level, since the backend filters by region subtree.
const QUICK_PICK_SLUGS = ['namba', 'umeda', 'kix', 'kyoto'] as const

export interface RegionPickerProps {
  regions: readonly RegionNode[]
  /** The selected region as its stable slug (the URL contract — #651 Decision 6), or null. */
  value: string | null
  onChange: (slug: string | null) => void
  disabled?: boolean
}

// The API is locale-agnostic (trilingual names); the client picks one by route locale.
function nameOf(region: RegionNode, locale: string): string {
  if (locale === 'ja') return region.nameJa
  if (locale === 'zh') return region.nameZh
  return region.nameEn
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

  const prefectures = regions.filter((r) => r.type === 'PREFECTURE' && r.status === 'ACTIVE')
  const cities = regions.filter(
    (r) => r.type === 'CITY' && r.parentId === chain.prefecture?.id && r.status === 'ACTIVE',
  )
  const areas = regions.filter(
    (r) =>
      r.type === 'AREA' && r.parentId === chain.city?.id && r.assignable && r.status === 'ACTIVE',
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
        // Denied / unavailable: a stale device point must never override a chosen area —
        // fall back to the full list (§6).
        setLocating(false)
        onChange(null)
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${ids}-prefecture`}>{t('prefecture')}</Label>
          <NativeSelect
            id={`${ids}-prefecture`}
            value={chain.prefecture?.id ?? ''}
            disabled={disabled}
            onChange={(e) => emit(e.target.value, null)}
          >
            <option value="">{t('anywhere')}</option>
            {prefectures.map((r) => (
              <option key={r.id} value={r.id}>
                {nameOf(r, locale)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor={`${ids}-city`}>{t('city')}</Label>
          <NativeSelect
            id={`${ids}-city`}
            value={chain.city?.id ?? ''}
            disabled={disabled || chain.prefecture === null}
            onChange={(e) => emit(e.target.value, chain.prefecture)}
          >
            <option value="">{t('allCities')}</option>
            {cities.map((r) => (
              <option key={r.id} value={r.id}>
                {nameOf(r, locale)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor={`${ids}-area`}>{t('area')}</Label>
          <NativeSelect
            id={`${ids}-area`}
            value={chain.area?.id ?? ''}
            disabled={disabled || chain.city === null}
            onChange={(e) => emit(e.target.value, chain.city)}
          >
            <option value="">{t('allAreas')}</option>
            {areas.map((r) => (
              <option key={r.id} value={r.id}>
                {nameOf(r, locale)}
              </option>
            ))}
          </NativeSelect>
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
              {nameOf(r, locale)}
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
