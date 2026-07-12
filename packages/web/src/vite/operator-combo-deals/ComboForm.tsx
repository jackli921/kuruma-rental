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
import { Switch } from '@/components/ui/switch'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  type CreateClassRatePlanInput,
  createClassRatePlanSchema,
} from '@kuruma/shared/validators/class-rate-plan'
import { Controller, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

type ComboFormValues = z.input<typeof createClassRatePlanSchema>
type ComboFormOutput = z.output<typeof createClassRatePlanSchema>

/** Minimal shape the class dropdown needs — satisfied by #528's OperatorClass. */
export interface ComboClassOption {
  id: string
  name: string
}

/** Minimal shape the location dropdown needs — satisfied by #529's OperatorLocation. */
export interface ComboLocationOption {
  id: string
  name: string
}

interface ComboFormProps {
  onSubmit: (data: CreateClassRatePlanInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateClassRatePlanInput>
  classes: readonly ComboClassOption[]
  locations: readonly ComboLocationOption[]
  isSubmitting?: boolean
}

export function ComboForm({
  onSubmit,
  onCancel,
  defaultValues,
  classes,
  locations,
  isSubmitting,
}: ComboFormProps) {
  const t = useTranslations('business.comboDeals')

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ComboFormValues, unknown, ComboFormOutput>({
    resolver: zodResolver(createClassRatePlanSchema),
    defaultValues: {
      // Required UUIDs — no sentinel; an unpicked value stays '' and the resolver
      // rejects it (a non-UUID) so the operator can't submit an empty scope.
      classId: '',
      pickupLocationId: '',
      dayRateJpy: 0,
      label: null,
      isActive: true,
      ...defaultValues,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit(data)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="combo-class">{t('form.vehicleClass')}</Label>
        <Controller
          control={control}
          name="classId"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v ?? '')}>
              <SelectTrigger id="combo-class" aria-label={t('form.vehicleClass')}>
                <SelectValue placeholder={t('form.vehicleClassPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.classId && (
          <p className="text-sm text-destructive mt-1">{errors.classId.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="combo-location">{t('form.pickupLocation')}</Label>
        <Controller
          control={control}
          name="pickupLocationId"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v ?? '')}>
              <SelectTrigger id="combo-location" aria-label={t('form.pickupLocation')}>
                <SelectValue placeholder={t('form.pickupLocationPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.pickupLocationId && (
          <p className="text-sm text-destructive mt-1">{errors.pickupLocationId.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="combo-rate">{t('form.dayRate')}</Label>
        <Input
          id="combo-rate"
          type="number"
          min={0}
          {...register('dayRateJpy', { valueAsNumber: true })}
        />
        {errors.dayRateJpy && (
          <p className="text-sm text-destructive mt-1">{errors.dayRateJpy.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="combo-label">{t('form.label')}</Label>
        <Input
          id="combo-label"
          type="text"
          placeholder={t('form.labelPlaceholder')}
          {...register('label', { setValueAs: (v) => (v === '' ? null : v) })}
        />
        <p className="text-xs text-muted-foreground mt-1">{t('form.labelHint')}</p>
        {errors.label && <p className="text-sm text-destructive mt-1">{errors.label.message}</p>}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="combo-active">{t('form.active')}</Label>
          <p className="text-xs text-muted-foreground mt-1">{t('form.activeHint')}</p>
        </div>
        <Controller
          control={control}
          name="isActive"
          render={({ field }) => (
            <Switch
              id="combo-active"
              checked={field.value ?? true}
              onCheckedChange={field.onChange}
              aria-label={t('form.active')}
            />
          )}
        />
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
