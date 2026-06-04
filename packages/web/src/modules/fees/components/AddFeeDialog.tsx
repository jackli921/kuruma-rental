'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { VehicleClassData } from '@/modules/classes'
import { createFeeScheduleAction } from '@/modules/fees/actions'
import { FeeScheduleForm } from '@/modules/fees/components/FeeScheduleForm'
import { useFeeMutation } from '@/modules/fees/hooks'
import { useTranslations } from 'next-intl'

interface AddFeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: VehicleClassData[]
}

export function AddFeeDialog({ open, onOpenChange, classes }: AddFeeDialogProps) {
  const t = useTranslations('business.fees')
  const { mutateAsync, isPending, error, reset } = useFeeMutation({
    mutationFn: createFeeScheduleAction,
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
          <DialogTitle>{t('addFee')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <FeeScheduleForm
          classes={classes}
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
