import { Label } from '@/components/ui/label'
import { LocationCombobox } from '@/vite/regions'
import type { RegionNode } from '@kuruma/shared/types/region'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

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
 * Operator region override (#651 Slice 2b, #1276): dependent comboboxes
 * prefecture -> city -> (optional) area. A CITY is now assignable, so selecting one is
 * a valid terminal choice; the AREA level appears only when the chosen city has
 * assignable ACTIVE area children and refines the selection one level deeper. Leaving
 * everything blank lets the server loop guard auto-derive the nearest area from the
 * location's address.
 */
export function RegionCascade({ regions, value, onChange, disabled }: RegionCascadeProps) {
  const t = useTranslations('business.locations.form.region')
  const ids = useId()

  // Local navigation state: which prefecture/city is "open". Seeded from the current
  // value so an edit prefills the chain.
  const seeded = chainFor(regions, value)
  const [prefectureId, setPrefectureId] = useState<string | null>(seeded.prefectureId)
  const [cityId, setCityId] = useState<string | null>(seeded.cityId)

  // Our handlers set this so a self-inflicted onChange doesn't bounce back through the
  // resync effect and clobber the navigation the operator just made.
  const selfChange = useRef(false)
  // Read the latest taxonomy without making the resync fire on `regions` identity churn.
  const regionsRef = useRef(regions)
  regionsRef.current = regions

  // Resync local navigation when `value` changes from OUTSIDE this component (a form
  // reset, editing a different location, a server-driven setValue). The mount-only seed
  // alone silently desyncs the dropdowns from `value` the moment this control is reused
  // without a remount (review H1); the skip flag preserves in-progress navigation.
  useEffect(() => {
    if (selfChange.current) {
      selfChange.current = false
      return
    }
    const next = chainFor(regionsRef.current, value)
    setPrefectureId(next.prefectureId)
    setCityId(next.cityId)
  }, [value])

  const prefectures = regions.filter((r) => r.type === 'PREFECTURE')
  const cities = regions.filter((r) => r.type === 'CITY' && r.parentId === prefectureId)
  const areas = regions.filter(
    (r) => r.type === 'AREA' && r.parentId === cityId && r.assignable && r.status === 'ACTIVE',
  )

  // A CITY terminal lives in the city level, so the area level stays on its placeholder;
  // an AREA (or a since-removed / INACTIVE id) belongs to the area level.
  const selectedNode = value !== null ? regions.find((r) => r.id === value) : undefined
  const isCityValue = selectedNode?.type === 'CITY'
  const areaValue = isCityValue ? '' : (value ?? '')
  // A previously-assigned AREA that is no longer selectable (INACTIVE or removed) still
  // arrives as `value`; keep it as an option so an edit shows the current assignment
  // instead of a misleading blank a blind re-save could misread (review M3).
  const showCurrentFallback = value !== null && !isCityValue && !areas.some((a) => a.id === value)
  const showArea = areas.length > 0 || showCurrentFallback
  const areaOptions = showCurrentFallback && selectedNode ? [selectedNode, ...areas] : areas

  const handlePrefecture = (next: string) => {
    selfChange.current = true
    setPrefectureId(next || null)
    setCityId(null)
    onChange(null)
  }
  const handleCity = (next: string) => {
    selfChange.current = true
    const nextCityId = next || null
    setCityId(nextCityId)
    onChange(cityTerminalId(regions, nextCityId))
  }
  // Picking an area sets it as the terminal; clearing it falls back to the city when
  // that city is itself assignable, else null.
  const handleArea = (next: string) => {
    selfChange.current = true
    onChange(next || cityTerminalId(regions, cityId))
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div>
        <Label htmlFor={`${ids}-prefecture`}>{t('prefecture')}</Label>
        <LocationCombobox
          id={`${ids}-prefecture`}
          regions={prefectures}
          value={prefectureId ?? ''}
          placeholder={t('placeholder')}
          disabled={disabled}
          onChange={handlePrefecture}
        />
      </div>
      <div>
        <Label htmlFor={`${ids}-city`}>{t('city')}</Label>
        <LocationCombobox
          id={`${ids}-city`}
          regions={cities}
          value={cityId ?? ''}
          placeholder={t('placeholder')}
          disabled={disabled || prefectureId === null}
          onChange={handleCity}
        />
      </div>
      {showArea && (
        <div>
          <Label htmlFor={`${ids}-area`}>{t('area')}</Label>
          <LocationCombobox
            id={`${ids}-area`}
            regions={areaOptions}
            value={areaValue}
            placeholder={t('placeholder')}
            disabled={disabled || cityId === null}
            onChange={handleArea}
          />
        </div>
      )}
    </div>
  )
}
