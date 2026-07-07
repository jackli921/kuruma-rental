import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InsuranceForm } from '@/vite/operator-insurance/InsuranceForm'
import {
  type CreateInsuranceOptionInput,
  INSURANCE_QUERY_KEY,
  type InsuranceOptionData,
  updateInsuranceOption,
} from '@/vite/operator-insurance/api'
import { buildNameBundle } from '@/vite/operator-insurance/name-bundle'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface EditInsuranceDialogProps {
  option: InsuranceOptionData | null
  onOpenChange: (open: boolean) => void
}

export function EditInsuranceDialog({ option, onOpenChange }: EditInsuranceDialogProps) {
  const t = useTranslations('business.insurance')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: CreateInsuranceOptionInput) =>
      updateInsuranceOption(option?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSURANCE_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={option !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editOption')}</DialogTitle>
          <DialogDescription>{option?.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {option && (
          <InsuranceForm
            key={option.id}
            onSubmit={async (data) => {
              await mutateAsync({
                nameI18n: buildNameBundle(data.nameEn, data.nameJa, data.nameZh),
                description: data.description.trim() || null,
                dailyPriceJpy: data.dailyPriceJpy,
                deductibleJpy: data.deductibleJpy,
              })
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              // Prefill the locale slots; a legacy row (nameI18n null) seeds `en`
              // from the `name` mirror so a price-only edit needn't re-type the name.
              nameEn: option.nameI18n?.en ?? option.name,
              nameJa: option.nameI18n?.ja ?? '',
              nameZh: option.nameI18n?.zh ?? '',
              description: option.description ?? '',
              dailyPriceJpy: option.dailyPriceJpy,
              deductibleJpy: option.deductibleJpy,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
