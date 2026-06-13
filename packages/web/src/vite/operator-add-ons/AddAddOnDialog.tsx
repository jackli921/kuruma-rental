import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'
import { ADDON_QUERY_KEY, type CreateAddOnInput, createAddOn } from '@/vite/operator-add-ons/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddAddOnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddAddOnDialog({ open, onOpenChange }: AddAddOnDialogProps) {
  const t = useTranslations('business.addOns')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateAddOnInput) => createAddOn(data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_QUERY_KEY })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addOption')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <AddOnForm
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
