'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { createVehicleSchema, type CreateVehicleInput } from '@kuruma/shared/validators/vehicle'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'

interface VehicleFormProps {
  onSubmit: (data: CreateVehicleInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleInput>
  isSubmitting?: boolean
}

export function VehicleForm({ onSubmit, onCancel, defaultValues, isSubmitting }: VehicleFormProps) {
  const t = useTranslations('business.vehicles')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: {
      name: '',
      description: '',
      seats: 5,
      transmission: 'AUTO',
      fuelType: '',
      bufferMinutes: 60,
      photos: [],
      ...defaultValues,
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">{t('form.name')}</Label>
        <Input
          id="name"
          placeholder={t('form.namePlaceholder')}
          {...register('name')}
        />
        {errors.name && (
          <p className="text-sm text-destructive mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="description">{t('form.description')}</Label>
        <Textarea
          id="description"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="seats">{t('form.seats')}</Label>
          <Input
            id="seats"
            type="number"
            {...register('seats', { valueAsNumber: true })}
          />
          {errors.seats && (
            <p className="text-sm text-destructive mt-1">{errors.seats.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="transmission">{t('form.transmission')}</Label>
          <select
            id="transmission"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('transmission')}
          >
            <option value="AUTO">{t('form.transmissionAuto')}</option>
            <option value="MANUAL">{t('form.transmissionManual')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fuelType">{t('form.fuelType')}</Label>
          <Input
            id="fuelType"
            placeholder={t('form.fuelTypePlaceholder')}
            {...register('fuelType')}
          />
        </div>

        <div>
          <Label htmlFor="bufferMinutes">{t('form.bufferMinutes')}</Label>
          <Input
            id="bufferMinutes"
            type="number"
            {...register('bufferMinutes', { valueAsNumber: true })}
          />
        </div>
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
