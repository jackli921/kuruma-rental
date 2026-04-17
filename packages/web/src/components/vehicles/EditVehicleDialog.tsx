'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { useVehicleMutation } from '@/hooks/useVehicleMutation'
import { updateVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
import type { CreateVehicleInput } from '@kuruma/shared/validators/vehicle'
import { useTranslations } from 'next-intl'

interface EditVehicleDialogProps {
  vehicle: VehicleData | null
  onOpenChange: (open: boolean) => void
}

export function EditVehicleDialog({ vehicle, onOpenChange }: EditVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const { mutate, isPending, error } = useVehicleMutation<CreateVehicleInput>({
    mutationFn: (data) => updateVehicleAction(vehicle?.id ?? '', data),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editVehicle')}</DialogTitle>
          <DialogDescription>{vehicle?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        {vehicle && (
          <VehicleForm
            key={vehicle.id}
            onSubmit={async (data) => mutate(data)}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              name: vehicle.name,
              ...(vehicle.description != null && { description: vehicle.description }),
              photos: vehicle.photos ?? [],
              seats: vehicle.seats,
              transmission: vehicle.transmission,
              ...(vehicle.fuelType != null && { fuelType: vehicle.fuelType }),
              bufferMinutes: vehicle.bufferMinutes,
              // Issue #60: the rate inputs were added in #48 but this
              // whitelist forgot to forward them, so the edit form
              // rendered them empty and every save attempt failed the
              // "at least one rate is required" validator.
              dailyRateJpy: vehicle.dailyRateJpy,
              hourlyRateJpy: vehicle.hourlyRateJpy,
              // Issue #50: forward rental rules so edit mode shows the
              // saved values instead of the form's create-mode defaults.
              // Same whitelist trap as #60 — forgetting a new field silently
              // falls back to `minRentalHours: 4, maxRentalHours: 72`.
              minRentalHours: vehicle.minRentalHours,
              maxRentalHours: vehicle.maxRentalHours,
              advanceBookingHours: vehicle.advanceBookingHours,
              shakenExpiryDate: vehicle.shakenExpiryDate,
              insuranceExpiryDate: vehicle.insuranceExpiryDate,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
