'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createInsuranceOptionAction } from '@/modules/insurance/actions'
import { InsuranceForm } from '@/modules/insurance/components/InsuranceForm'
import { useInsuranceMutation } from '@/modules/insurance/hooks'
import { useTranslations } from 'next-intl'

interface AddInsuranceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddInsuranceDialog({ open, onOpenChange }: AddInsuranceDialogProps) {
  const t = useTranslations('business.insurance')
  const { mutateAsync, isPending, error, reset } = useInsuranceMutation({
    mutationFn: createInsuranceOptionAction,
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
          <DialogTitle>{t('addOption')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <InsuranceForm
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
