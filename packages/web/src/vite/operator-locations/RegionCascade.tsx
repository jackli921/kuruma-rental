import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { RegionNode } from '@kuruma/shared/types/region'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

interface RegionCascadeProps {
  /** Flat taxonomy from GET /regions (every prefecture/city/area node). */
  regions: readonly RegionNode[]
  /** The selected region id — always a deepest (assignable AREA) node, or null. */
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

// Walk the area -> city -> prefecture chain for a selected (area) region id, so an
// edit prefills all three selects. Returns nulls for null / unknown / non-area ids.
function chainFor(regions: readonly RegionNode[], regionId: string | null) {
  if (regionId === null) return { prefectureId: null, cityId: null }
  const byId = new Map(regions.map((r) => [r.id, r]))
  const area = byId.get(regionId)
  const city = area?.parentId != null ? byId.get(area.parentId) : undefined
  return { prefectureId: city?.parentId ?? null, cityId: city?.id ?? null }
}

/**
 * Operator region override (#651 Slice 2b): three dependent dropdowns
 * (prefecture -> city -> area). Only the deepest AREA level is assignable, so only
 * an area selection produces a real `regionId`; picking a prefecture/city resets the
 * value to null until an area is chosen. Leaving everything blank lets the server
 * loop guard auto-derive the nearest area from the location's address.
 */
export function RegionCascade({ regions, value, onChange, disabled }: RegionCascadeProps) {
  const t = useTranslations('business.locations.form.region')
  const locale = useLocale()

  // Local navigation state: which prefecture/city is "open". Seeded from the current
  // value so edit prefills the chain; the dialog's key={id} remount re-seeds it.
  const seeded = chainFor(regions, value)
  const [prefectureId, setPrefectureId] = useState<string | null>(seeded.prefectureId)
  const [cityId, setCityId] = useState<string | null>(seeded.cityId)

  const prefectures = regions.filter((r) => r.type === 'PREFECTURE')
  const cities = regions.filter((r) => r.type === 'CITY' && r.parentId === prefectureId)
  const areas = regions.filter(
    (r) => r.type === 'AREA' && r.parentId === cityId && r.assignable && r.status === 'ACTIVE',
  )
  // A previously-assigned region that is no longer selectable (went INACTIVE or was
  // removed) still arrives as `value`; keep it visible as a fallback option so an edit
  // shows the current assignment instead of a misleading blank that a blind re-save
  // could misread.
  const current = value !== null ? regions.find((r) => r.id === value) : undefined
  const showCurrentFallback = value !== null && !areas.some((a) => a.id === value)

  const handlePrefecture = (next: string) => {
    setPrefectureId(next || null)
    setCityId(null)
    onChange(null)
  }
  const handleCity = (next: string) => {
    setCityId(next || null)
    onChange(null)
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
      <div>
        <Label htmlFor="region-area">{t('area')}</Label>
        <NativeSelect
          id="region-area"
          value={value ?? ''}
          disabled={disabled || cityId === null}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('placeholder')}</option>
          {showCurrentFallback && (
            <option value={value ?? ''}>{current ? nameOf(current, locale) : (value ?? '')}</option>
          )}
          {areas.map((r) => (
            <option key={r.id} value={r.id}>
              {nameOf(r, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}
