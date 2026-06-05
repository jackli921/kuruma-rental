'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PhotoUpload } from '@/components/vehicles/PhotoUpload'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { useVehicleMutation } from '@/hooks/useVehicleMutation'
import { updateVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
import type { VehicleClassData } from '@/modules/classes'
import type { LocationData } from '@/modules/locations'
import type { CreateVehicleInput } from '@kuruma/shared/validators/vehicle'
import { useTranslations } from 'next-intl'

interface EditVehicleDialogProps {
  vehicle: VehicleData | null
  onOpenChange: (open: boolean) => void
  classes?: readonly VehicleClassData[] | undefined
  locations?: readonly LocationData[] | undefined
}

export function EditVehicleDialog({
  vehicle,
  onOpenChange,
  classes,
  locations,
}: EditVehicleDialogProps) {
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
          <PhotoUpload
            key={vehicle.id}
            vehicleId={vehicle.id}
            initialPhotos={vehicle.photos ?? []}
          />
        )}
        {vehicle && (
          <VehicleForm
            key={vehicle.id}
            onSubmit={async (data) => mutate(data)}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            classes={classes}
            locations={locations}
            operatorId={vehicle.operatorId}
            defaultValues={{
              name: vehicle.name,
              classId: vehicle.classId,
              pickupLocationId: vehicle.pickupLocationId,
              ...(vehicle.description != null && { description: vehicle.description }),
              photos: vehicle.photos ?? [],
              seats: vehicle.seats,
              transmission: vehicle.transmission,
              ...(vehicle.fuelType != null && { fuelType: vehicle.fuelType }),
              dailyRateJpy: vehicle.dailyRateJpy,
              hourlyRateJpy: vehicle.hourlyRateJpy,
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
