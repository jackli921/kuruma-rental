'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { type CreateVehicleInput, createVehicleSchema } from '@kuruma/shared/validators/vehicle'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

type VehicleFormValues = z.input<typeof createVehicleSchema>

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
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: {
      name: '',
      description: '',
      seats: 5,
      transmission: 'AUTO',
      fuelType: '',
      bufferMinutes: 60,
      photos: [],
      // Issue #50: sensible defaults owner-side so create mode is pre-filled
      // with typical shop rules. Edit mode overrides via ...defaultValues
      // (even with null — spread preserves explicit nulls).
      minRentalHours: 4,
      maxRentalHours: 72,
      advanceBookingHours: null,
      ...defaultValues,
    },
  })

  // Numeric fields that must submit `null` (not NaN or undefined) when blank.
  // Matches the pricing pattern from #48.
  const nullableNumber = (v: unknown) => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }

  return (
    <form
      onSubmit={handleSubmit((data) => onSubmit(data as CreateVehicleInput))}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="name">{t('form.name')}</Label>
        <Input id="name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
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
          <Input id="seats" type="number" {...register('seats', { valueAsNumber: true })} />
          {errors.seats && <p className="text-sm text-destructive mt-1">{errors.seats.message}</p>}
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

      {/* Pricing (#48). At least one rate is required — enforced server-side
          by the createVehicleSchema superRefine and DB CHECK constraint. */}
      <div>
        <div className="text-sm font-medium mb-2">{t('form.pricingHeading')}</div>
        <p className="text-xs text-muted-foreground mb-3">{t('form.pricingHint')}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="dailyRateJpy">{t('form.dailyRate')}</Label>
            <Input
              id="dailyRateJpy"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="8000"
              {...register('dailyRateJpy', {
                setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
              })}
            />
            {errors.dailyRateJpy && (
              <p className="text-sm text-destructive mt-1">{errors.dailyRateJpy.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="hourlyRateJpy">{t('form.hourlyRate')}</Label>
            <Input
              id="hourlyRateJpy"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="1200"
              {...register('hourlyRateJpy', {
                setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
              })}
            />
            {errors.hourlyRateJpy && (
              <p className="text-sm text-destructive mt-1">{errors.hourlyRateJpy.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Rental rules (#50). All optional; each controls a different booking
          constraint and is enforced at booking-creation time in a follow-up
          issue. If both min and max are set, validator requires min <= max. */}
      <div>
        <div className="text-sm font-medium mb-2">{t('form.rentalRulesHeading')}</div>
        <p className="text-xs text-muted-foreground mb-3">{t('form.rentalRulesHint')}</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="minRentalHours">{t('form.minRentalHours')}</Label>
            <Input
              id="minRentalHours"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={t('form.minRentalHoursPlaceholder')}
              {...register('minRentalHours', { setValueAs: nullableNumber })}
            />
            {errors.minRentalHours && (
              <p className="text-sm text-destructive mt-1">{errors.minRentalHours.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="maxRentalHours">{t('form.maxRentalHours')}</Label>
            <Input
              id="maxRentalHours"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={t('form.maxRentalHoursPlaceholder')}
              {...register('maxRentalHours', { setValueAs: nullableNumber })}
            />
            {errors.maxRentalHours && (
              <p className="text-sm text-destructive mt-1">{errors.maxRentalHours.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="advanceBookingHours">{t('form.advanceBookingHours')}</Label>
            <Input
              id="advanceBookingHours"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={t('form.advanceBookingHoursPlaceholder')}
              {...register('advanceBookingHours', { setValueAs: nullableNumber })}
            />
            {errors.advanceBookingHours && (
              <p className="text-sm text-destructive mt-1">{errors.advanceBookingHours.message}</p>
            )}
          </div>
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
