import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { z } from 'zod'

// #1437 slice 3: insurance is PURELY self-authored — the operator writes their own
// en/ja/zh name bundle (no picker, unlike add-ons). The form holds three flat name
// slots; the dialog collapses them into a `nameI18n` bundle (buildNameBundle) before
// the wire. en is required (the guaranteed fallback); ja/zh are nudged, never
// required. A single description slot in the caller's UI locale, plus price + an
// optional deductible.
export interface InsuranceFormValues {
  nameEn: string
  nameJa: string
  nameZh: string
  description: string
  dailyPriceJpy: number
  deductibleJpy: number | null
}

const priceField = z
  .number()
  .int('Daily price must be a whole number of yen')
  .min(0, 'Daily price cannot be negative')

// The form's own lenient schema: ja/zh may be blank here (the shared
// localizedTextSchema rejects '' — the dialog drops empty slots before the wire).
// en is required via superRefine so a self-authored option always has a floor.
const formSchema = z
  .object({
    nameEn: z.string(),
    nameJa: z.string(),
    nameZh: z.string(),
    description: z.string(),
    dailyPriceJpy: priceField,
    deductibleJpy: z
      .number()
      .int('Deductible must be a whole number of yen')
      .min(0, 'Deductible cannot be negative')
      .nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.nameEn.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nameEn'],
        message: 'Enter an English name',
      })
    }
  })

interface InsuranceFormProps {
  onSubmit: (data: InsuranceFormValues) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<InsuranceFormValues>
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
  } = useForm<InsuranceFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nameEn: '',
      nameJa: '',
      nameZh: '',
      description: '',
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
      <fieldset className="space-y-2">
        <div>
          <Label htmlFor="insurance-name-en">{t('form.nameEn')}</Label>
          <Input
            id="insurance-name-en"
            aria-invalid={errors.nameEn ? true : undefined}
            {...register('nameEn')}
          />
          {errors.nameEn && (
            <p className="text-sm text-destructive mt-1">{errors.nameEn.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="insurance-name-ja">{t('form.nameJa')}</Label>
          <Input id="insurance-name-ja" {...register('nameJa')} />
        </div>
        <div>
          <Label htmlFor="insurance-name-zh">{t('form.nameZh')}</Label>
          <Input id="insurance-name-zh" {...register('nameZh')} />
        </div>
        {/* Tourists read English wherever ja/zh are blank — nudge, never require. */}
        <p className="text-xs text-muted-foreground">{t('form.customNameNudge')}</p>
      </fieldset>

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
