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
import type { UpdateVehicleClassInput } from '@kuruma/shared/validators/vehicle-class'
import { useTranslations } from 'next-intl'

interface EditClassDialogProps {
  vehicleClass: VehicleClassData | null
  onOpenChange: (open: boolean) => void
}

export function EditClassDialog({ vehicleClass, onOpenChange }: EditClassDialogProps) {
  const t = useTranslations('business.classes')
  // #413: an edit is a PATCH — type the mutation with the update input so the
  // form (mode="edit") and updateClassAction agree on UpdateVehicleClassInput.
  const { mutateAsync, isPending, error } = useClassMutation<UpdateVehicleClassInput>({
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
            mode="edit"
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
              luggageSize: vehicleClass.luggageSize,
              transmission: vehicleClass.transmission,
              ...(vehicleClass.fuelType != null && { fuelType: vehicleClass.fuelType }),
              ...(vehicleClass.acrissCode != null && { acrissCode: vehicleClass.acrissCode }),
              sortOrder: vehicleClass.sortOrder,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
