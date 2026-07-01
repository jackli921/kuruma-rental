import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ClassForm } from '@/vite/operator-classes/ClassForm'
import { type OperatorClass, updateOperatorClass } from '@/vite/operator-classes/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditClassDialogProps {
  readonly vehicleClass: OperatorClass | null
  readonly onOpenChange: (open: boolean) => void
}

// #528 slice 5. Edit is a PATCH (ClassForm mode="edit" emits UpdateVehicleClassInput).
// Open when a class is selected; on success invalidate the list and close. The
// #456 "operator-scope edit options" concern is moot in the Vite portal — there
// is no operator picker (operators edit only their own tenant, server-scoped),
// and operatorId is non-patchable, so an edit can't reassign tenancy.
export function EditClassDialog({ vehicleClass, onOpenChange }: EditClassDialogProps) {
  const t = useTranslations('business.classes')
  const queryClient = useQueryClient()
  // Cookie writes need the double-submit CSRF token echoed in the header (#1304).
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: Parameters<typeof updateOperatorClass>[1]) =>
      updateOperatorClass(vehicleClass?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operator-classes'] })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={vehicleClass !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editClass')}</DialogTitle>
          <DialogDescription>{vehicleClass?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="px-1 text-sm text-destructive">{error.message}</p>}
        {vehicleClass && (
          <ClassForm
            // Remount per class so the form re-seeds its defaults on selection.
            key={vehicleClass.id}
            mode="edit"
            onSubmit={async (data) => {
              await mutateAsync(data).catch(() => {})
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
