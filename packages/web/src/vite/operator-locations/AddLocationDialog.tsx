import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WithOperatorId } from '@/vite/operator-context'
import { LocationForm } from '@/vite/operator-locations/LocationForm'
import {
  type CreateLocationInput,
  LOCATIONS_QUERY_KEY,
  createLocation,
} from '@/vite/operator-locations/api'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { useSession } from '@/vite/session'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddLocationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Set when a platform admin has picked a tenant. Merged into the create body so
  // the server's platform-admin create schema (which requires operatorId) is
  // satisfied; an operator session leaves this undefined and is auto-scoped.
  pickedOperatorId?: string | undefined
}

// #529 slice 2: create a location. Cookie-based POST (operator-scoped
// server-side); a duplicate name comes back as a 409 whose message renders
// inline while the dialog stays open. Closing resets the mutation so a prior
// error never lingers on the next open.
export function AddLocationDialog({
  open,
  onOpenChange,
  pickedOperatorId,
}: AddLocationDialogProps) {
  const t = useTranslations('business.locations')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const { data: regions } = useQuery(regionsQueryOptions())
  const mutation = useMutation({
    mutationFn: (data: WithOperatorId<CreateLocationInput>) => createLocation(data, csrfToken),
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addLocation')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {mutation.error && (
          <p className="text-sm text-destructive px-1">{mutation.error.message}</p>
        )}
        <LocationForm
          onSubmit={async (data) => {
            // Fire-and-forget: error surfaces via mutation.error, success closes
            // in onSuccess. Awaiting mutateAsync would reject into rhf's handler.
            mutation.mutate(pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={mutation.isPending}
          regions={regions ?? []}
        />
      </DialogContent>
    </Dialog>
  )
}
