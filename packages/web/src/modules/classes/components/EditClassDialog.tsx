'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateClassAction } from '@/modules/classes/actions'
import type { VehicleClassData } from '@/modules/classes/api'
import { ClassForm } from '@/modules/classes/components/ClassForm'
import { useClassMutation } from '@/modules/classes/hooks'
import type { CreateVehicleClassInput } from '@kuruma/shared/validators/vehicle-class'
import { useTranslations } from 'next-intl'

interface EditClassDialogProps {
  vehicleClass: VehicleClassData | null
  onOpenChange: (open: boolean) => void
}

export function EditClassDialog({ vehicleClass, onOpenChange }: EditClassDialogProps) {
  const t = useTranslations('business.classes')
  const { mutateAsync, isPending, error } = useClassMutation<CreateVehicleClassInput>({
    mutationFn: (data) => updateClassAction(vehicleClass?.id ?? '', data),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={vehicleClass !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editClass')}</DialogTitle>
          <DialogDescription>{vehicleClass?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        {vehicleClass && (
          <ClassForm
            key={vehicleClass.id}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              name: vehicleClass.name,
              slug: vehicleClass.slug,
              ...(vehicleClass.description != null && { description: vehicleClass.description }),
              photos: vehicleClass.photos,
              seats: vehicleClass.seats,
              luggageCapacity: vehicleClass.luggageCapacity,
              transmission: vehicleClass.transmission,
              ...(vehicleClass.fuelType != null && { fuelType: vehicleClass.fuelType }),
              dailyRateJpy: vehicleClass.dailyRateJpy,
              hourlyRateJpy: vehicleClass.hourlyRateJpy,
              sortOrder: vehicleClass.sortOrder,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
