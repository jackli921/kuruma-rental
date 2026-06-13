import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'
import {
  ADDON_QUERY_KEY,
  type AddOnData,
  type CreateAddOnInput,
  updateAddOn,
} from '@/vite/operator-add-ons/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditAddOnDialogProps {
  addOn: AddOnData | null
  onOpenChange: (open: boolean) => void
}

export function EditAddOnDialog({ addOn, onOpenChange }: EditAddOnDialogProps) {
  const t = useTranslations('business.addOns')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: CreateAddOnInput) => updateAddOn(addOn?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={addOn !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editOption')}</DialogTitle>
          <DialogDescription>{addOn?.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {addOn && (
          <AddOnForm
            key={addOn.id}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              name: addOn.name,
              description: addOn.description,
              priceJpy: addOn.priceJpy,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
