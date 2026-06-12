import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  type CreateInsuranceOptionInput,
  createInsuranceOptionSchema,
} from '@kuruma/shared/validators/insurance-option'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

type InsuranceFormValues = z.input<typeof createInsuranceOptionSchema>
type InsuranceFormOutput = z.output<typeof createInsuranceOptionSchema>

interface InsuranceFormProps {
  onSubmit: (data: CreateInsuranceOptionInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateInsuranceOptionInput>
  isSubmitting?: boolean
}

export function InsuranceForm({
  onSubmit,
  onCancel,
  defaultValues,
  isSubmitting,
}: InsuranceFormProps) {
  const t = useTranslations('business.insurance')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<InsuranceFormValues, unknown, InsuranceFormOutput>({
    resolver: zodResolver(createInsuranceOptionSchema),
    defaultValues: {
      name: '',
      description: null,
      dailyPriceJpy: 0,
      deductibleJpy: null,
      ...defaultValues,
    },
  })

  // Deductible is optional: null = full cover (no deductible). The toggle keeps
  // it null until the operator opts in — a blank field must never become NaN
  // that the integer schema would reject.
  const [deductibleEnabled, setDeductibleEnabled] = useState(defaultValues?.deductibleJpy != null)
  const handleDeductibleToggle = (enabled: boolean) => {
    setDeductibleEnabled(enabled)
    setValue('deductibleJpy', enabled ? 0 : null)
  }

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit(data)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="insurance-name">{t('form.name')}</Label>
        <Input id="insurance-name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="insurance-description">{t('form.description')}</Label>
        <Textarea
          id="insurance-description"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive mt-1">{errors.description.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="insurance-dailyPrice">{t('form.dailyPrice')}</Label>
        <Input
          id="insurance-dailyPrice"
          type="number"
          {...register('dailyPriceJpy', { valueAsNumber: true })}
        />
        <p className="text-xs text-muted-foreground mt-1">{t('form.dailyPriceHint')}</p>
        {errors.dailyPriceJpy && (
          <p className="text-sm text-destructive mt-1">{errors.dailyPriceJpy.message}</p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={deductibleEnabled}
            onChange={(e) => handleDeductibleToggle(e.target.checked)}
          />
          {t('form.setDeductible')}
        </label>
        <p className="text-xs text-muted-foreground mt-1">{t('form.deductibleHint')}</p>
        {deductibleEnabled && (
          <div className="mt-3">
            <Label htmlFor="insurance-deductible">{t('form.deductible')}</Label>
            <Input
              id="insurance-deductible"
              type="number"
              {...register('deductibleJpy', { valueAsNumber: true })}
            />
            {errors.deductibleJpy && (
              <p className="text-sm text-destructive mt-1">{errors.deductibleJpy.message}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </form>
  )
}
