import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { RegionNode } from '@kuruma/shared/types/region'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

interface RegionCascadeProps {
  /** Flat taxonomy from GET /regions (every prefecture/city/area node). */
  regions: readonly RegionNode[]
  /**
   * The selected region id, or null. Terminal at either level (#1276): an assignable
   * CITY (operator picks prefecture -> city and stops) or a deeper AREA node.
   */
  value: string | null
  onChange: (regionId: string | null) => void
  disabled?: boolean
}

// The API is locale-agnostic (trilingual names); the client picks one by route locale.
function nameOf(region: RegionNode, locale: string): string {
  if (locale === 'ja') return region.nameJa
  if (locale === 'zh') return region.nameZh
  return region.nameEn
}

// Resolve a selected region id into its prefecture/city navigation slots so an edit
// prefills the dropdowns. Slots are filled by each node's `type` (not by tree depth) —
// mirroring regions/region-lookup.ts regionChain — so a CITY value prefills as well as
// an AREA one. A visited set bounds the upward walk against a malformed self-FK cycle
// (regions.parentId has no DB-level cycle constraint). Null/unknown ids yield empties.
function chainFor(regions: readonly RegionNode[], regionId: string | null) {
  if (regionId === null) return { prefectureId: null, cityId: null }
  const byId = new Map(regions.map((r) => [r.id, r]))
  const seen = new Set<string>()
  let node = byId.get(regionId) ?? null
  let prefectureId: string | null = null
  let cityId: string | null = null
  while (node !== null && !seen.has(node.id)) {
    seen.add(node.id)
    if (node.type === 'PREFECTURE') prefectureId = node.id
    else if (node.type === 'CITY') cityId = node.id
    node = node.parentId !== null ? (byId.get(node.parentId) ?? null) : null
  }
  return { prefectureId, cityId }
}

// A CITY is a valid terminal selection only when it is itself assignable and ACTIVE;
// otherwise it is navigation-only and the operator must drill into an AREA (null).
function cityTerminalId(regions: readonly RegionNode[], cityId: string | null): string | null {
  const city = cityId !== null ? regions.find((r) => r.id === cityId) : undefined
  return city?.assignable && city.status === 'ACTIVE' ? city.id : null
}

/**
 * Operator region override (#651 Slice 2b, #1276): dependent dropdowns
 * prefecture -> city -> (optional) area. A CITY is now assignable, so selecting one is
 * a valid terminal choice; the AREA select appears only when the chosen city has
 * assignable ACTIVE area children and refines the selection one level deeper. Leaving
 * everything blank lets the server loop guard auto-derive the nearest area from the
 * location's address.
 */
export function RegionCascade({ regions, value, onChange, disabled }: RegionCascadeProps) {
  const t = useTranslations('business.locations.form.region')
  const locale = useLocale()

  // Local navigation state: which prefecture/city is "open". Seeded from the current
  // value so edit prefills the chain; the dialog's key remount re-seeds it.
  const seeded = chainFor(regions, value)
  const [prefectureId, setPrefectureId] = useState<string | null>(seeded.prefectureId)
  const [cityId, setCityId] = useState<string | null>(seeded.cityId)

  const prefectures = regions.filter((r) => r.type === 'PREFECTURE')
  const cities = regions.filter((r) => r.type === 'CITY' && r.parentId === prefectureId)
  const areas = regions.filter(
    (r) => r.type === 'AREA' && r.parentId === cityId && r.assignable && r.status === 'ACTIVE',
  )

  // A CITY terminal lives in the city select, so the area select stays on its
  // placeholder; an AREA (or a since-removed / INACTIVE id) belongs to the area select.
  const selectedNode = value !== null ? regions.find((r) => r.id === value) : undefined
  const isCityValue = selectedNode?.type === 'CITY'
  const areaValue = isCityValue ? '' : (value ?? '')
  // A previously-assigned AREA that is no longer selectable (INACTIVE or removed) still
  // arrives as `value`; keep it visible as a fallback so an edit shows the current
  // assignment instead of a misleading blank a blind re-save could misread.
  const showCurrentFallback = value !== null && !isCityValue && !areas.some((a) => a.id === value)
  // The area level is an optional refinement: render it only when the city offers
  // assignable areas, or when a fallback area must stay visible.
  const showArea = areas.length > 0 || showCurrentFallback

  const handlePrefecture = (next: string) => {
    setPrefectureId(next || null)
    setCityId(null)
    onChange(null)
  }
  const handleCity = (next: string) => {
    const nextCityId = next || null
    setCityId(nextCityId)
    onChange(cityTerminalId(regions, nextCityId))
  }
  // Picking an area sets it as the terminal; clearing it falls back to the city when
  // that city is itself assignable, else null.
  const handleArea = (next: string) => {
    onChange(next || cityTerminalId(regions, cityId))
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div>
        <Label htmlFor="region-prefecture">{t('prefecture')}</Label>
        <NativeSelect
          id="region-prefecture"
          value={prefectureId ?? ''}
          disabled={disabled}
          onChange={(e) => handlePrefecture(e.target.value)}
        >
          <option value="">{t('placeholder')}</option>
          {prefectures.map((r) => (
            <option key={r.id} value={r.id}>
              {nameOf(r, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor="region-city">{t('city')}</Label>
        <NativeSelect
          id="region-city"
          value={cityId ?? ''}
          disabled={disabled || prefectureId === null}
          onChange={(e) => handleCity(e.target.value)}
        >
          <option value="">{t('placeholder')}</option>
          {cities.map((r) => (
            <option key={r.id} value={r.id}>
              {nameOf(r, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {showArea && (
        <div>
          <Label htmlFor="region-area">{t('area')}</Label>
          <NativeSelect
            id="region-area"
            value={areaValue}
            disabled={disabled || cityId === null}
            onChange={(e) => handleArea(e.target.value)}
          >
            <option value="">{t('placeholder')}</option>
            {showCurrentFallback && (
              <option value={value ?? ''}>
                {selectedNode ? nameOf(selectedNode, locale) : (value ?? '')}
              </option>
            )}
            {areas.map((r) => (
              <option key={r.id} value={r.id}>
                {nameOf(r, locale)}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  )
}
