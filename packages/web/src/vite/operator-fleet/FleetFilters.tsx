import { Badge } from '@/components/ui/badge'
import { BadgeGroup } from '@/components/ui/badge-group'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  type FleetFilterState,
  type Transmission,
  type VehicleStatus,
  filterVehicles,
} from '@/lib/fleet-filters'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { useMemo } from 'react'
import { useTranslations } from 'use-intl'

interface FleetFiltersProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly value: FleetFilterState
  readonly onChange: (next: FleetFilterState) => void
}

const STATUS_OPTIONS: readonly VehicleStatus[] = ['AVAILABLE', 'MAINTENANCE', 'RETIRED']
const TRANSMISSION_OPTIONS: readonly Transmission[] = ['AUTO', 'MANUAL']

const TRANSMISSION_LABEL_KEYS: Record<Transmission, string> = {
  AUTO: 'transmissionAuto',
  MANUAL: 'transmissionManual',
}

// Toggle a value into/out of an immutable selection array (membership filter).
function toggleInArray<T>(items: readonly T[] | undefined, value: T): T[] {
  const current = items ?? []
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

// Distinct, sorted non-null values for one facet column. Sorting keeps badge
// order stable across renders regardless of insertion order.
function distinctValues<T extends string | number>(
  vehicles: readonly OperatorFleetVehicle[],
  pick: (v: OperatorFleetVehicle) => T | null,
): T[] {
  const seen = new Set<T>()
  for (const v of vehicles) {
    const value = pick(v)
    if (value != null) seen.add(value)
  }
  return [...seen].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  )
}

// Facet count = how many vehicles would survive if ONLY this option were
// selected, derived through the canonical filterVehicles predicate so the
// number a badge shows always matches what selecting it actually yields.
function facetCount(vehicles: readonly OperatorFleetVehicle[], filter: FleetFilterState): number {
  return filterVehicles([...vehicles], filter).length
}

// Presentational, fully controlled filters sidebar over the operator fleet.
// State lives in the parent (value/onChange); this component derives the
// available facet options + counts from `vehicles` via the shared
// fleet-filters lib and emits a new FleetFilterState on every interaction.
// No mutation, no data fetching (FC/IS — the decision logic is the imported
// pure lib, this is the thin render shell).
export function FleetFilters({ vehicles, value, onChange }: FleetFiltersProps) {
  const t = useTranslations('business.vehicles.filter')
  const tStatus = useTranslations('business.vehicles.status')

  const seatOptions = useMemo(() => distinctValues(vehicles, (v) => v.seats), [vehicles])
  const makeOptions = useMemo(() => distinctValues(vehicles, (v) => v.make), [vehicles])
  const modelOptions = useMemo(() => distinctValues(vehicles, (v) => v.model), [vehicles])
  const yearOptions = useMemo(() => distinctValues(vehicles, (v) => v.year), [vehicles])
  const colorOptions = useMemo(() => distinctValues(vehicles, (v) => v.color), [vehicles])

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    onChange({ ...value, search: next === '' ? undefined : next })
  }

  const handleStatusToggle = (status: VehicleStatus) => {
    onChange({ ...value, statuses: toggleInArray(value.statuses, status) })
  }

  const handleTransmissionToggle = (transmission: Transmission) => {
    onChange({ ...value, transmissions: toggleInArray(value.transmissions, transmission) })
  }

  const handleSeatsToggle = (seats: number) => {
    onChange({ ...value, seats: toggleInArray(value.seats, seats) })
  }

  const handleMakeToggle = (make: string) => {
    onChange({ ...value, makes: toggleInArray(value.makes, make) })
  }

  const handleModelToggle = (model: string) => {
    onChange({ ...value, models: toggleInArray(value.models, model) })
  }

  const handleYearToggle = (year: number) => {
    onChange({ ...value, years: toggleInArray(value.years, year) })
  }

  const handleColorToggle = (color: string) => {
    onChange({ ...value, colors: toggleInArray(value.colors, color) })
  }

  return (
    <div className="space-y-4" aria-label={t('title')}>
      <div className="space-y-2">
        <Input
          type="search"
          placeholder={t('searchPlaceholder')}
          value={value.search ?? ''}
          onChange={handleSearchChange}
        />
      </div>

      <Separator />

      <FacetSection heading={t('statusHeading')}>
        <BadgeGroup
          items={STATUS_OPTIONS}
          selected={value.statuses}
          onToggle={handleStatusToggle}
          label={(status) =>
            withCount(tStatus(status), facetCount(vehicles, { statuses: [status] }))
          }
          groupLabel={t('statusHeading')}
        />
      </FacetSection>

      <Separator />

      <FacetSection heading={t('transmissionHeading')}>
        <BadgeGroup
          items={TRANSMISSION_OPTIONS}
          selected={value.transmissions}
          onToggle={handleTransmissionToggle}
          label={(transmission) =>
            withCount(
              t(TRANSMISSION_LABEL_KEYS[transmission]),
              facetCount(vehicles, { transmissions: [transmission] }),
            )
          }
          groupLabel={t('transmissionHeading')}
        />
      </FacetSection>

      {seatOptions.length > 1 && (
        <>
          <Separator />
          <FacetSection heading={t('capacityHeading')}>
            <BadgeGroup
              items={seatOptions}
              selected={value.seats}
              onToggle={handleSeatsToggle}
              label={(seats) =>
                withCount(
                  t('seatsBadgeLabel', { count: seats }),
                  facetCount(vehicles, { seats: [seats] }),
                )
              }
              groupLabel={t('capacityHeading')}
            />
          </FacetSection>
        </>
      )}

      {makeOptions.length > 1 && (
        <>
          <Separator />
          <FacetSection heading={t('makeHeading')}>
            <BadgeGroup
              items={makeOptions}
              selected={value.makes}
              onToggle={handleMakeToggle}
              label={(make) => withCount(make, facetCount(vehicles, { makes: [make] }))}
              groupLabel={t('makeHeading')}
            />
          </FacetSection>
        </>
      )}

      {modelOptions.length > 1 && (
        <>
          <Separator />
          <FacetSection heading={t('modelHeading')}>
            <BadgeGroup
              items={modelOptions}
              selected={value.models}
              onToggle={handleModelToggle}
              label={(model) => withCount(model, facetCount(vehicles, { models: [model] }))}
              groupLabel={t('modelHeading')}
            />
          </FacetSection>
        </>
      )}

      {yearOptions.length > 1 && (
        <>
          <Separator />
          <FacetSection heading={t('yearHeading')}>
            <BadgeGroup
              items={yearOptions}
              selected={value.years}
              onToggle={handleYearToggle}
              label={(year) => withCount(String(year), facetCount(vehicles, { years: [year] }))}
              groupLabel={t('yearHeading')}
            />
          </FacetSection>
        </>
      )}

      {colorOptions.length > 1 && (
        <>
          <Separator />
          <FacetSection heading={t('colorHeading')}>
            <BadgeGroup
              items={colorOptions}
              selected={value.colors}
              onToggle={handleColorToggle}
              label={(color) => withCount(color, facetCount(vehicles, { colors: [color] }))}
              groupLabel={t('colorHeading')}
            />
          </FacetSection>
        </>
      )}

      <Separator />

      <FacetSection heading={t('complianceHeading')}>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={value.expiringSoon ? 'default' : 'outline'}
            render={
              <button
                type="button"
                aria-pressed={value.expiringSoon ?? false}
                onClick={() => onChange({ ...value, expiringSoon: !value.expiringSoon })}
              />
            }
          >
            {withCount(t('expiringSoonLabel'), facetCount(vehicles, { expiringSoon: true }))}
          </Badge>
        </div>
      </FacetSection>
    </div>
  )
}

function withCount(label: string, count: number): string {
  return `${label} (${count})`
}

function FacetSection({
  heading,
  children,
}: {
  readonly heading: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      {children}
    </div>
  )
}
