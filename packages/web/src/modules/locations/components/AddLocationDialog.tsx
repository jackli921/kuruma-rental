'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createLocationAction } from '@/modules/locations/actions'
import { LocationForm } from '@/modules/locations/components/LocationForm'
import { useLocationMutation } from '@/modules/locations/hooks'
import { useTranslations } from 'next-intl'

interface AddLocationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddLocationDialog({ open, onOpenChange }: AddLocationDialogProps) {
  const t = useTranslations('business.locations')
  const { mutateAsync, isPending, error, reset } = useLocationMutation({
    mutationFn: createLocationAction,
    onSuccess: () => onOpenChange(false),
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addLocation')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <LocationForm
          onSubmit={async (data) => {
            await mutateAsync(data)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
