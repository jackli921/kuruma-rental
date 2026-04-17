'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { useTranslations } from 'next-intl'

export interface BookingSlotPickerValue {
  vehicleId: string
  startAt: string
  endAt: string
  notes: string
}

export const INITIAL_BOOKING_SLOT_PICKER_VALUE: BookingSlotPickerValue = {
  vehicleId: '',
  startAt: '',
  endAt: '',
  notes: '',
}

interface BookingSlotPickerProps {
  readonly value: BookingSlotPickerValue
  readonly onChange: (next: BookingSlotPickerValue) => void
  readonly vehicles: readonly FleetVehicleOverviewData[]
  // Rendered below the date inputs when the selected vehicle is unavailable
  // for the chosen window. Parent owns the check (it's time-sensitive).
  readonly availabilityError: string | null
}

export function BookingSlotPicker({
  value,
  onChange,
  vehicles,
  availabilityError,
}: BookingSlotPickerProps) {
  const t = useTranslations('business.bookings.manualBooking')
  const availableVehicles = vehicles.filter((v) => v.status === 'AVAILABLE')

  const patch = (p: Partial<BookingSlotPickerValue>) => onChange({ ...value, ...p })

  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium mb-1">{t('bookingDetails')}</legend>

      <div>
        <Label htmlFor="mb-vehicle">{t('vehicle')}</Label>
        <select
          id="mb-vehicle"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.vehicleId}
          onChange={(e) => patch({ vehicleId: e.target.value })}
        >
          <option value="">{t('selectVehicle')}</option>
          {availableVehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.licensePlate ? `(${v.licensePlate})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="mb-start">{t('startAt')}</Label>
          <Input
            id="mb-start"
            type="datetime-local"
            value={value.startAt}
            onChange={(e) => patch({ startAt: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="mb-end">{t('endAt')}</Label>
          <Input
            id="mb-end"
            type="datetime-local"
            value={value.endAt}
            onChange={(e) => patch({ endAt: e.target.value })}
          />
        </div>
      </div>

      {availabilityError && <p className="text-sm text-destructive">{availabilityError}</p>}

      <div>
        <Label htmlFor="mb-notes">{t('notes')}</Label>
        <Textarea
          id="mb-notes"
          value={value.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder={t('notesPlaceholder')}
          rows={2}
        />
      </div>
    </fieldset>
  )
}
