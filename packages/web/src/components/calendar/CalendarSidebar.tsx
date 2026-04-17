'use client'

import { Button } from '@/components/ui/button'
import type { BookingStatus } from '@kuruma/shared/db/schema'
import { useTranslations } from 'next-intl'

interface SidebarVehicle {
  readonly id: string
  readonly name: string
}

interface FiltersApi {
  readonly isVehicleChecked: (id: string) => boolean
  readonly isStatusChecked: (status: BookingStatus) => boolean
  readonly toggleVehicle: (id: string) => void
  readonly toggleStatus: (status: BookingStatus) => void
  readonly selectAllVehicles: () => void
  readonly clearAllVehicles: () => void
}

interface CalendarSidebarProps {
  readonly vehicles: readonly SidebarVehicle[]
  readonly filters: FiltersApi
}

const STATUSES: readonly BookingStatus[] = ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED']

// Matches STATUS_CLASS / calendar-theme.css — keeps the sidebar dot in sync
// with the calendar event color.
const STATUS_DOT: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-blue-500',
  ACTIVE: 'bg-green-500',
  COMPLETED: 'bg-gray-400',
  CANCELLED: 'bg-red-500',
}

export function CalendarSidebar({ vehicles, filters }: CalendarSidebarProps) {
  const t = useTranslations('business.bookings.calendar.sidebar')

  return (
    <aside className="hidden md:block w-64 shrink-0 border rounded-md p-4 space-y-6">
      <h2 className="text-sm font-semibold">{t('title')}</h2>

      <fieldset className="space-y-2" aria-label={t('vehicles.title')}>
        <div className="flex items-center justify-between">
          <legend className="text-xs font-medium text-muted-foreground">
            {t('vehicles.title')}
          </legend>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={filters.selectAllVehicles}
              className="h-7 px-2 text-xs"
            >
              {t('vehicles.all')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={filters.clearAllVehicles}
              className="h-7 px-2 text-xs"
            >
              {t('vehicles.none')}
            </Button>
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
          {vehicles.map((v) => (
            <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filters.isVehicleChecked(v.id)}
                onChange={() => filters.toggleVehicle(v.id)}
                className="size-4 rounded border-input"
              />
              <span className="truncate">{v.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2" aria-label={t('statuses.title')}>
        <legend className="text-xs font-medium text-muted-foreground">{t('statuses.title')}</legend>
        <div className="space-y-1.5">
          {STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filters.isStatusChecked(s)}
                onChange={() => filters.toggleStatus(s)}
                className="size-4 rounded border-input"
              />
              <span className={`size-2.5 rounded-full ${STATUS_DOT[s]}`} aria-hidden="true" />
              <span>{t(`statuses.${s}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
