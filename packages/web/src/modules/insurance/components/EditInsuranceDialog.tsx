'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { updateInsuranceOptionAction } from '@/modules/insurance/actions'
import type { InsuranceOptionData } from '@/modules/insurance/api'
import { InsuranceForm } from '@/modules/insurance/components/InsuranceForm'
import { useInsuranceMutation } from '@/modules/insurance/hooks'
import type { CreateInsuranceOptionInput } from '@kuruma/shared/validators/insurance-option'
import { useTranslations } from 'next-intl'

interface EditInsuranceDialogProps {
  option: InsuranceOptionData | null
  onOpenChange: (open: boolean) => void
}

export function EditInsuranceDialog({ option, onOpenChange }: EditInsuranceDialogProps) {
  const t = useTranslations('business.insurance')
  const { mutateAsync, isPending, error } = useInsuranceMutation<CreateInsuranceOptionInput>({
    mutationFn: (data) => updateInsuranceOptionAction(option?.id ?? '', data),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={option !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editOption')}</DialogTitle>
          <DialogDescription>{option?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        {option && (
          <InsuranceForm
            key={option.id}
            onSubmit={async (data) => {
              await mutateAsync(data)
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              name: option.name,
              description: option.description,
              dailyPriceJpy: option.dailyPriceJpy,
              deductibleJpy: option.deductibleJpy,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
