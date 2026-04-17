'use client'

import { Badge } from '@/components/ui/badge'
import { BadgeGroup } from '@/components/ui/badge-group'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { FleetFilterState, SortOrder, Transmission, VehicleStatus } from '@/lib/fleet-filters'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

interface FleetFiltersProps {
  readonly filters: FleetFilterState
  readonly sort: SortOrder
  readonly onFiltersChange: (filters: FleetFilterState) => void
  readonly onSortChange: (sort: SortOrder) => void
  readonly seatsBounds: { min: number; max: number }
  readonly availableMakes: readonly string[]
  readonly availableModels: readonly string[]
  readonly availableYears: readonly number[]
  readonly availableColors: readonly string[]
}

const STATUS_OPTIONS: readonly VehicleStatus[] = ['AVAILABLE', 'MAINTENANCE', 'RETIRED']
const TRANSMISSION_OPTIONS: readonly Transmission[] = ['AUTO', 'MANUAL']

const STATUS_LABEL_KEYS: Record<VehicleStatus, string> = {
  AVAILABLE: 'status.AVAILABLE',
  MAINTENANCE: 'status.MAINTENANCE',
  RETIRED: 'status.RETIRED',
}

const TRANSMISSION_LABEL_KEYS: Record<Transmission, string> = {
  AUTO: 'transmissionAuto',
  MANUAL: 'transmissionManual',
}

const SORT_OPTIONS: readonly { value: SortOrder; labelKey: string }[] = [
  { value: 'utilization-desc', labelKey: 'sortUtilizationDesc' },
  { value: 'name-asc', labelKey: 'sortNameAsc' },
  { value: 'name-desc', labelKey: 'sortNameDesc' },
  { value: 'seats-asc', labelKey: 'sortSeatsAsc' },
  { value: 'seats-desc', labelKey: 'sortSeatsDesc' },
  { value: 'price-asc', labelKey: 'sortPriceAsc' },
  { value: 'price-desc', labelKey: 'sortPriceDesc' },
]

function toggleInArray<T>(items: readonly T[] | undefined, value: T): T[] {
  const current = items ?? []
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

function SectionHeading({ children }: { readonly children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
      {children}
    </h3>
  )
}

export function FleetFilters({
  filters,
  sort,
  onFiltersChange,
  onSortChange,
  seatsBounds,
  availableMakes,
  availableModels,
  availableYears,
  availableColors,
}: FleetFiltersProps) {
  const t = useTranslations('business.vehicles.filter')
  const tStatus = useTranslations('business.vehicles')

  const hasCapacityRange = seatsBounds.min < seatsBounds.max

  const seatOptions = useMemo(
    () =>
      hasCapacityRange
        ? Array.from(
            { length: seatsBounds.max - seatsBounds.min + 1 },
            (_, i) => seatsBounds.min + i,
          )
        : [],
    [hasCapacityRange, seatsBounds.min, seatsBounds.max],
  )

  const statusLabel = (status: VehicleStatus): string => tStatus(STATUS_LABEL_KEYS[status])

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    onFiltersChange({ ...filters, search: value === '' ? undefined : value })
  }

  const handleStatusToggle = (status: VehicleStatus) => {
    onFiltersChange({
      ...filters,
      statuses: toggleInArray(filters.statuses, status),
    })
  }

  const handleTransmissionToggle = (transmission: Transmission) => {
    onFiltersChange({
      ...filters,
      transmissions: toggleInArray(filters.transmissions, transmission),
    })
  }

  const handleSeatsToggle = (seats: number) => {
    onFiltersChange({
      ...filters,
      seats: toggleInArray(filters.seats, seats),
    })
  }

  const handleMakeToggle = (make: string) => {
    onFiltersChange({ ...filters, makes: toggleInArray(filters.makes, make) })
  }

  const handleModelToggle = (model: string) => {
    onFiltersChange({ ...filters, models: toggleInArray(filters.models, model) })
  }

  const handleYearToggle = (year: number) => {
    onFiltersChange({ ...filters, years: toggleInArray(filters.years, year) })
  }

  const handleColorToggle = (color: string) => {
    onFiltersChange({ ...filters, colors: toggleInArray(filters.colors, color) })
  }

  const handleSortChange = (value: SortOrder | null) => {
    if (value) {
      onSortChange(value)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Input
          type="search"
          placeholder={t('searchPlaceholder')}
          value={filters.search ?? ''}
          onChange={handleSearchChange}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading>{t('statusHeading')}</SectionHeading>
        <BadgeGroup
          items={STATUS_OPTIONS}
          selected={filters.statuses}
          onToggle={handleStatusToggle}
          label={statusLabel}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading>{t('transmissionHeading')}</SectionHeading>
        <BadgeGroup
          items={TRANSMISSION_OPTIONS}
          selected={filters.transmissions}
          onToggle={handleTransmissionToggle}
          label={(key) => t(TRANSMISSION_LABEL_KEYS[key])}
        />
      </div>

      {hasCapacityRange && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('capacityHeading')}</SectionHeading>
            <BadgeGroup
              items={seatOptions}
              selected={filters.seats}
              onToggle={handleSeatsToggle}
              label={(seats) => t('seatsBadgeLabel', { count: seats })}
            />
          </div>
        </>
      )}

      {availableMakes.length > 1 && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('makeHeading')}</SectionHeading>
            <BadgeGroup
              items={availableMakes}
              selected={filters.makes}
              onToggle={handleMakeToggle}
            />
          </div>
        </>
      )}

      {availableModels.length > 1 && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('modelHeading')}</SectionHeading>
            <BadgeGroup
              items={availableModels}
              selected={filters.models}
              onToggle={handleModelToggle}
            />
          </div>
        </>
      )}

      {availableYears.length > 1 && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('yearHeading')}</SectionHeading>
            <BadgeGroup
              items={availableYears}
              selected={filters.years}
              onToggle={handleYearToggle}
            />
          </div>
        </>
      )}

      {availableColors.length > 1 && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('colorHeading')}</SectionHeading>
            <BadgeGroup
              items={availableColors}
              selected={filters.colors}
              onToggle={handleColorToggle}
            />
          </div>
        </>
      )}

      <Separator />

      <div className="space-y-2">
        <SectionHeading>{t('complianceHeading')}</SectionHeading>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={filters.expiringSoon ? 'default' : 'outline'}
            render={
              <button
                type="button"
                aria-pressed={filters.expiringSoon ?? false}
                onClick={() => onFiltersChange({ ...filters, expiringSoon: !filters.expiringSoon })}
              />
            }
          >
            {t('expiringSoonLabel')}
          </Badge>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading>{t('sortHeading')}</SectionHeading>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
