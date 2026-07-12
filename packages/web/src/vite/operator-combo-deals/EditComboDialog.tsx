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
  type ClassRatePlanData,
  type CreateClassRatePlanInput,
  updateComboDeal,
} from '@/vite/operator-combo-deals/api'
import { comboErrorMessage } from '@/vite/operator-combo-deals/combo-errors'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditComboDialogProps {
  deal: ClassRatePlanData | null
  onOpenChange: (open: boolean) => void
  classes: readonly ComboClassOption[]
  locations: readonly ComboLocationOption[]
  /** Binds the PATCH to the picked operator via `?operatorId=`; omitted for an
   *  operator session (tenant-clamped server-side). */
  pickedOperatorId?: string | undefined
}

export function EditComboDialog({
  deal,
  onOpenChange,
  classes,
  locations,
  pickedOperatorId,
}: EditComboDialogProps) {
  const t = useTranslations('business.comboDeals')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateClassRatePlanInput) =>
      updateComboDeal(deal?.id ?? '', data, csrfToken, pickedOperatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Clear a prior failure on close so reopening the dialog (for this or another
  // deal) never flashes a stale error banner.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={deal !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editDeal')}</DialogTitle>
          <DialogDescription>{deal?.label ?? t('editSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{comboErrorMessage(error, t)}</p>}
        {deal && (
          <ComboForm
            key={deal.id}
            classes={classes}
            locations={locations}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => handleOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              classId: deal.classId,
              pickupLocationId: deal.pickupLocationId,
              dayRateJpy: deal.dayRateJpy,
              label: deal.label,
              isActive: deal.isActive,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
