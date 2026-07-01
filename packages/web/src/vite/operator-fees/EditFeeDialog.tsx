import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type FeeClassOption, FeeScheduleForm } from '@/vite/operator-fees/FeeScheduleForm'
import {
  type CreateFeeScheduleInput,
  FEE_QUERY_KEY,
  type FeeScheduleData,
  updateFeeSchedule,
} from '@/vite/operator-fees/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditFeeDialogProps {
  fee: FeeScheduleData | null
  onOpenChange: (open: boolean) => void
  classes: readonly FeeClassOption[]
}

export function EditFeeDialog({ fee, onOpenChange, classes }: EditFeeDialogProps) {
  const t = useTranslations('business.fees')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: CreateFeeScheduleInput) => updateFeeSchedule(fee?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FEE_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={fee !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editFee')}</DialogTitle>
          <DialogDescription>{fee ? t(`type.${fee.feeType}`) : ''}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {fee && (
          <FeeScheduleForm
            key={fee.id}
            classes={classes}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              feeType: fee.feeType,
              unit: fee.unit,
              amountJpy: fee.amountJpy,
              vehicleClassId: fee.vehicleClassId,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
