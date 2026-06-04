'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { VehicleClassData } from '@/modules/classes'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  type CreateFeeScheduleInput,
  FEE_TYPES,
  REQUIRED_UNIT_BY_FEE_TYPE,
  createFeeScheduleSchema,
} from '@kuruma/shared/validators/fee-schedule'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

type FeeFormValues = z.input<typeof createFeeScheduleSchema>
type FeeFormOutput = z.output<typeof createFeeScheduleSchema>

interface FeeScheduleFormProps {
  onSubmit: (data: CreateFeeScheduleInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateFeeScheduleInput>
  classes: VehicleClassData[]
  isSubmitting?: boolean
}

// Sentinel for the "operator-wide" (no class) Select option — Radix Select
// cannot use an empty-string value.
const OPERATOR_WIDE = '__operator_wide__'

export function FeeScheduleForm({
  onSubmit,
  onCancel,
  defaultValues,
  classes,
  isSubmitting,
}: FeeScheduleFormProps) {
  const t = useTranslations('business.fees')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FeeFormValues, unknown, FeeFormOutput>({
    resolver: zodResolver(createFeeScheduleSchema),
    defaultValues: {
      feeType: 'CLEANING_FLAT',
      unit: 'FLAT',
      amountJpy: 0,
      vehicleClassId: null,
      ...defaultValues,
    },
  })

  const feeType = watch('feeType')
  const vehicleClassId = watch('vehicleClassId')
  // The unit is fully determined by the fee type (the validator enforces the
  // same coherence rule). Constrain it here so the operator never picks an
  // incompatible pair — the unit is shown read-only, derived from the type.
  const requiredUnit = REQUIRED_UNIT_BY_FEE_TYPE[feeType]

  const handleFeeTypeChange = (value: string | null) => {
    if (value === null) return
    const next = value as (typeof FEE_TYPES)[number]
    setValue('feeType', next)
    setValue('unit', REQUIRED_UNIT_BY_FEE_TYPE[next])
  }

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit(data)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="fee-type">{t('form.feeType')}</Label>
        <Select value={feeType} onValueChange={handleFeeTypeChange}>
          <SelectTrigger id="fee-type" aria-label={t('form.feeType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FEE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`type.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.feeType && (
          <p className="text-sm text-destructive mt-1">{errors.feeType.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="fee-unit">{t('form.unit')}</Label>
        {/* Unit is fully derived from the fee type (the validator enforces the
            same coherence rule), so it is read-only. The hidden register binding
            carries the canonical enum value to the resolver; the visible field
            shows the localized label. */}
        <input type="hidden" {...register('unit')} />
        <Input
          id="fee-unit"
          readOnly
          aria-label={t('form.unit')}
          value={t(`unit.${requiredUnit}`)}
        />
        <p className="text-xs text-muted-foreground mt-1">{t('form.unitHint')}</p>
      </div>

      <div>
        <Label htmlFor="fee-amount">{t('form.amount')}</Label>
        <Input
          id="fee-amount"
          type="number"
          min={0}
          {...register('amountJpy', { valueAsNumber: true })}
        />
        {errors.amountJpy && (
          <p className="text-sm text-destructive mt-1">{errors.amountJpy.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="fee-class">{t('form.vehicleClass')}</Label>
        <Select
          value={vehicleClassId ?? OPERATOR_WIDE}
          onValueChange={(value) =>
            setValue('vehicleClassId', value === null || value === OPERATOR_WIDE ? null : value)
          }
        >
          <SelectTrigger id="fee-class" aria-label={t('form.vehicleClass')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPERATOR_WIDE}>{t('form.operatorWide')}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">{t('form.vehicleClassHint')}</p>
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
