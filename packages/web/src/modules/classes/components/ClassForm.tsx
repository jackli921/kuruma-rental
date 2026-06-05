'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { ACRISS_CODES } from '@kuruma/shared/acriss'
import {
  type CreateVehicleClassInput,
  createVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

type ClassFormValues = z.input<typeof createVehicleClassSchema>
type ClassFormOutput = z.output<typeof createVehicleClassSchema>

interface ClassFormProps {
  onSubmit: (data: CreateVehicleClassInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleClassInput>
  isSubmitting?: boolean
}

// The ACRISS <select>'s "None" option has an empty value. Coerce it to null so
// the schema's .nullish() accepts it instead of failing the regex on ''.
function nullableString(v: unknown) {
  return v === '' || v == null ? null : v
}

const ACRISS_CODE_LIST = Object.keys(ACRISS_CODES) as (keyof typeof ACRISS_CODES)[]

export function ClassForm({ onSubmit, onCancel, defaultValues, isSubmitting }: ClassFormProps) {
  const t = useTranslations('business.classes')
  // ACRISS labels live under the top-level `acriss.*` namespace, not
  // `business.classes`, so resolve them through a separate translator.
  const tAcriss = useTranslations('acriss')

  // MEDIUM 3: three-type-parameter useForm lets RHF narrow the submit
  // handler to the schema's OUTPUT type (CreateVehicleClassInput) — no
  // `as` assertion needed at handleSubmit.
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClassFormValues, unknown, ClassFormOutput>({
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
      onSubmit={handleSubmit(async (data) => {
        // MEDIUM 4: an empty Textarea submits `""`, not `undefined`. Coerce
        // blank/whitespace-only descriptions so the API receives "no
        // description" rather than an empty string value.
        const trimmed = data.description?.trim()
        const { description: _drop, ...rest } = data
        const payload: CreateVehicleClassInput =
          trimmed && trimmed.length > 0 ? { ...rest, description: trimmed } : rest
        await onSubmit(payload)
      })}
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

      <div>
        <Label htmlFor="class-acrissCode">{t('form.acrissCode')}</Label>
        <select
          id="class-acrissCode"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          {...register('acrissCode', { setValueAs: nullableString })}
        >
          <option value="">{t('form.acrissCodeNone')}</option>
          {ACRISS_CODE_LIST.map((code) => (
            <option key={code} value={code}>
              {tAcriss(code)}
            </option>
          ))}
        </select>
        {errors.acrissCode && (
          <p className="text-sm text-destructive mt-1">{errors.acrissCode.message}</p>
        )}
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
