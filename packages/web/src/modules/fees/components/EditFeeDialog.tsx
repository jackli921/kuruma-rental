'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { VehicleClassData } from '@/modules/classes'
import { updateFeeScheduleAction } from '@/modules/fees/actions'
import type { FeeScheduleData } from '@/modules/fees/api'
import { FeeScheduleForm } from '@/modules/fees/components/FeeScheduleForm'
import { useFeeMutation } from '@/modules/fees/hooks'
import type { CreateFeeScheduleInput } from '@kuruma/shared/validators/fee-schedule'
import { useTranslations } from 'next-intl'

interface EditFeeDialogProps {
  fee: FeeScheduleData | null
  onOpenChange: (open: boolean) => void
  classes: VehicleClassData[]
}

export function EditFeeDialog({ fee, onOpenChange, classes }: EditFeeDialogProps) {
  const t = useTranslations('business.fees')
  const { mutateAsync, isPending, error } = useFeeMutation<CreateFeeScheduleInput>({
    mutationFn: (data) => updateFeeScheduleAction(fee?.id ?? '', data),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={fee !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editFee')}</DialogTitle>
          <DialogDescription>{fee ? t(`type.${fee.feeType}`) : ''}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
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
