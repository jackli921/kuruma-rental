'use client'

import { Badge } from '@/components/ui/badge'
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

interface FleetFiltersProps {
  readonly filters: FleetFilterState
  readonly sort: SortOrder
  readonly onFiltersChange: (filters: FleetFilterState) => void
  readonly onSortChange: (sort: SortOrder) => void
  readonly seatsBounds: { min: number; max: number }
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
  { value: 'name-asc', labelKey: 'sortNameAsc' },
  { value: 'name-desc', labelKey: 'sortNameDesc' },
  { value: 'seats-asc', labelKey: 'sortSeatsAsc' },
  { value: 'seats-desc', labelKey: 'sortSeatsDesc' },
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
}: FleetFiltersProps) {
  const t = useTranslations('business.vehicles.filter')
  const tStatus = useTranslations('business.vehicles')

  const seatsMin = filters.seatsMin ?? seatsBounds.min
  const seatsMax = filters.seatsMax ?? seatsBounds.max
  const hasCapacityRange = seatsBounds.min < seatsBounds.max

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

  const handleSeatsMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextMin = Number(event.target.value)
    const clampedMax = Math.max(nextMin, seatsMax)
    onFiltersChange({
      ...filters,
      seatsMin: nextMin,
      seatsMax: clampedMax,
    })
  }

  const handleSeatsMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextMax = Number(event.target.value)
    const clampedMin = Math.min(seatsMin, nextMax)
    onFiltersChange({
      ...filters,
      seatsMin: clampedMin,
      seatsMax: nextMax,
    })
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
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((status) => {
            const isSelected = filters.statuses?.includes(status) ?? false
            return (
              <Badge
                key={status}
                variant={isSelected ? 'default' : 'outline'}
                render={
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={statusLabel(status)}
                    onClick={() => handleStatusToggle(status)}
                  />
                }
              >
                {statusLabel(status)}
              </Badge>
            )
          })}
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading>{t('transmissionHeading')}</SectionHeading>
        <div className="flex flex-wrap gap-1.5">
          {TRANSMISSION_OPTIONS.map((transmission) => {
            const isSelected = filters.transmissions?.includes(transmission) ?? false
            const label = t(TRANSMISSION_LABEL_KEYS[transmission])
            return (
              <Badge
                key={transmission}
                variant={isSelected ? 'default' : 'outline'}
                render={
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={label}
                    onClick={() => handleTransmissionToggle(transmission)}
                  />
                }
              >
                {label}
              </Badge>
            )
          })}
        </div>
      </div>

      {hasCapacityRange && (
        <>
          <Separator />
          <div className="space-y-2">
            <SectionHeading>{t('capacityHeading')}</SectionHeading>
            <p className="text-sm text-foreground">
              {t('seatsLabel', { min: seatsMin, max: seatsMax })}
            </p>
            <div className="space-y-2">
              <input
                type="range"
                aria-label={t('capacityHeading')}
                min={seatsBounds.min}
                max={seatsBounds.max}
                value={seatsMin}
                onChange={handleSeatsMinChange}
                className="w-full accent-primary"
              />
              <input
                type="range"
                aria-label={t('capacityHeading')}
                min={seatsBounds.min}
                max={seatsBounds.max}
                value={seatsMax}
                onChange={handleSeatsMaxChange}
                className="w-full accent-primary"
              />
            </div>
          </div>
        </>
      )}

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
