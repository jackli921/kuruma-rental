'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  type CreateVehicleClassInput,
  createVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

type ClassFormValues = z.input<typeof createVehicleClassSchema>

interface ClassFormProps {
  onSubmit: (data: CreateVehicleClassInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleClassInput>
  isSubmitting?: boolean
}

// Submit `null` (not NaN/undefined) when a numeric field is blank. Mirrors the
// pricing pattern from VehicleForm (#48).
function nullableNumber(v: unknown) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export function ClassForm({ onSubmit, onCancel, defaultValues, isSubmitting }: ClassFormProps) {
  const t = useTranslations('business.classes')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClassFormValues>({
    resolver: zodResolver(createVehicleClassSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: '',
      photos: [],
      sortOrder: 0,
      ...defaultValues,
    },
  })

  return (
    <form
      onSubmit={handleSubmit((data) => onSubmit(data as CreateVehicleClassInput))}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="class-name">{t('form.name')}</Label>
        <Input id="class-name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="class-slug">{t('form.slug')}</Label>
        <Input id="class-slug" placeholder={t('form.slugPlaceholder')} {...register('slug')} />
        <p className="text-xs text-muted-foreground mt-1">{t('form.slugHint')}</p>
        {errors.slug && <p className="text-sm text-destructive mt-1">{errors.slug.message}</p>}
      </div>

      <div>
        <Label htmlFor="class-description">{t('form.description')}</Label>
        <Textarea
          id="class-description"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="class-seats">{t('form.seats')}</Label>
          <Input
            id="class-seats"
            type="number"
            min={1}
            {...register('seats', { valueAsNumber: true })}
          />
          {errors.seats && <p className="text-sm text-destructive mt-1">{errors.seats.message}</p>}
        </div>
        <div>
          <Label htmlFor="class-luggage">{t('form.luggageCapacity')}</Label>
          <Input
            id="class-luggage"
            type="number"
            min={0}
            {...register('luggageCapacity', { valueAsNumber: true })}
          />
          {errors.luggageCapacity && (
            <p className="text-sm text-destructive mt-1">{errors.luggageCapacity.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="class-transmission">{t('form.transmission')}</Label>
          <select
            id="class-transmission"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('transmission')}
          >
            <option value="AUTO">{t('form.transmissionAuto')}</option>
            <option value="MANUAL">{t('form.transmissionManual')}</option>
          </select>
        </div>
        <div>
          <Label htmlFor="class-fuelType">{t('form.fuelType')}</Label>
          <Input
            id="class-fuelType"
            placeholder={t('form.fuelTypePlaceholder')}
            {...register('fuelType')}
          />
        </div>
      </div>

      {/* Pricing — at least one rate is required (enforced server-side) */}
      <div>
        <div className="text-sm font-medium mb-2">{t('form.pricingHeading')}</div>
        <p className="text-xs text-muted-foreground mb-3">{t('form.pricingHint')}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="class-dailyRate">{t('form.dailyRate')}</Label>
            <Input
              id="class-dailyRate"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="8000"
              {...register('dailyRateJpy', { setValueAs: nullableNumber })}
            />
            {errors.dailyRateJpy && (
              <p className="text-sm text-destructive mt-1">{errors.dailyRateJpy.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="class-hourlyRate">{t('form.hourlyRate')}</Label>
            <Input
              id="class-hourlyRate"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="1200"
              {...register('hourlyRateJpy', { setValueAs: nullableNumber })}
            />
            {errors.hourlyRateJpy && (
              <p className="text-sm text-destructive mt-1">{errors.hourlyRateJpy.message}</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="class-sortOrder">{t('form.sortOrder')}</Label>
        <Input
          id="class-sortOrder"
          type="number"
          min={0}
          {...register('sortOrder', { valueAsNumber: true })}
        />
        <p className="text-xs text-muted-foreground mt-1">{t('form.sortOrderHint')}</p>
        {errors.sortOrder && (
          <p className="text-sm text-destructive mt-1">{errors.sortOrder.message}</p>
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
