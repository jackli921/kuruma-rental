import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LocationForm } from '@/vite/operator-locations/LocationForm'
import {
  LOCATIONS_QUERY_KEY,
  type OperatorLocation,
  updateLocation,
} from '@/vite/operator-locations/api'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { useSession } from '@/vite/session'
import type { UpdateLocationInput } from '@kuruma/shared/validators/location'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditLocationDialogProps {
  location: OperatorLocation | null
  onOpenChange: (open: boolean) => void
}

// #529 slice 3: edit a location. The row already carries every field, so the
// form prefills from it — no GET /:id round-trip. PATCH via the no-default
// update schema (mode="edit"); `key={id}` resets the form when a different row
// opens. Mirrors AddLocationDialog's invalidate-and-close / reset-on-close flow.
export function EditLocationDialog({ location, onOpenChange }: EditLocationDialogProps) {
  const t = useTranslations('business.locations')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const { data: regions } = useQuery(regionsQueryOptions())
  const mutation = useMutation({
    mutationFn: (data: UpdateLocationInput) => updateLocation(location?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) mutation.reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={location !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editLocation')}</DialogTitle>
          <DialogDescription>{location?.name}</DialogDescription>
        </DialogHeader>
        {mutation.error && (
          <p className="text-sm text-destructive px-1">{mutation.error.message}</p>
        )}
        {location && (
          <LocationForm
            key={location.id}
            mode="edit"
            onSubmit={async (data) => {
              mutation.mutate(data)
            }}
            onCancel={() => handleOpenChange(false)}
            isSubmitting={mutation.isPending}
            regions={regions ?? []}
            defaultValues={{
              name: location.name,
              address: location.address,
              operatingHours: location.operatingHours,
              timezone: location.timezone,
              defaultTurnaroundMinutes: location.defaultTurnaroundMinutes,
              regionId: location.regionId,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
