'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateLocationAction } from '@/modules/locations/actions'
import type { LocationData } from '@/modules/locations/api'
import { LocationForm } from '@/modules/locations/components/LocationForm'
import { useLocationMutation } from '@/modules/locations/hooks'
import type { CreateLocationInput } from '@kuruma/shared/validators/location'
import { useTranslations } from 'next-intl'

interface EditLocationDialogProps {
  location: LocationData | null
  onOpenChange: (open: boolean) => void
}

export function EditLocationDialog({ location, onOpenChange }: EditLocationDialogProps) {
  const t = useTranslations('business.locations')
  const { mutateAsync, isPending, error } = useLocationMutation<CreateLocationInput>({
    mutationFn: (data) => updateLocationAction(location?.id ?? '', data),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={location !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editLocation')}</DialogTitle>
          <DialogDescription>{location?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        {location && (
          <LocationForm
            key={location.id}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              name: location.name,
              address: location.address,
              operatingHours: location.operatingHours,
              timezone: location.timezone,
              defaultTurnaroundMinutes: location.defaultTurnaroundMinutes,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
