import { Button } from '@/components/ui/button'
import { STATUS_DOT } from '@/lib/event-colors'
import { UnassignedFloatsList } from '@/vite/operator-bookings/UnassignedFloatsList'
import type { CalendarFiltersApi } from '@/vite/operator-bookings/useCalendarFilters'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import { useTranslations } from 'use-intl'

interface SidebarVehicle {
  readonly id: string
  readonly name: string
}

interface CalendarSidebarProps {
  readonly vehicles: readonly SidebarVehicle[]
  readonly filters: CalendarFiltersApi
  // #1230 slice 5a: forwarded to the floats worklist so a picker admin narrows it
  // to the picked operator. undefined = no pick / operator session.
  readonly pickedOperatorId?: string | undefined
}

const STATUSES = BOOKING_STATUSES

// Presentational filter sidebar (#525 Slice C), driven entirely by the filters
// API from useCalendarFilters. Hidden below md (the calendar takes the full width
// on narrow screens).
export function CalendarSidebar({ vehicles, filters, pickedOperatorId }: CalendarSidebarProps) {
  const t = useTranslations('business.bookings.calendar.sidebar')

  return (
    <aside className="hidden w-64 shrink-0 space-y-6 rounded-md border p-4 md:block">
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

        <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
          {vehicles.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-center gap-2 text-sm">
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
            <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
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

      {/* #464: unassigned CLASS_COMBO float worklist. Invalidated automatically
          when AssignVehicleDialog succeeds — the dialog already targets
          ['operator-bookings','needs-assignment']. */}
      <UnassignedFloatsList pickedOperatorId={pickedOperatorId} />
    </aside>
  )
}
