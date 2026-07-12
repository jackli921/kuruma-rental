import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  type ComboClassOption,
  ComboForm,
  type ComboLocationOption,
} from '@/vite/operator-combo-deals/ComboForm'
import {
  COMBO_QUERY_KEY,
  type CreateClassRatePlanInput,
  createComboDeal,
} from '@/vite/operator-combo-deals/api'
import { comboErrorMessage } from '@/vite/operator-combo-deals/combo-errors'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddComboDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: readonly ComboClassOption[]
  locations: readonly ComboLocationOption[]
  /** A picker admin stamps the chosen operatorId into the create body; an
   *  operator session omits it (the server auto-scopes the tenant). */
  pickedOperatorId?: string | undefined
}

export function AddComboDialog({
  open,
  onOpenChange,
  classes,
  locations,
  pickedOperatorId,
}: AddComboDialogProps) {
  const t = useTranslations('business.comboDeals')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateClassRatePlanInput) =>
      createComboDeal(
        pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data,
        csrfToken,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addDeal')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{comboErrorMessage(error, t)}</p>}
        <ComboForm
          classes={classes}
          locations={locations}
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
