import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { ACRISS_CODES } from '@kuruma/shared/acriss'
import { LUGGAGE_SIZES } from '@kuruma/shared/lib/luggage'
import {
  type CreateVehicleClassInput,
  type UpdateVehicleClassInput,
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { type Resolver, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

type ClassFormValues = z.input<typeof createVehicleClassSchema>
type ClassFormOutput = z.output<typeof createVehicleClassSchema>

// One form, two modes (#413). Create validates with createVehicleClassSchema and
// emits CreateVehicleClassInput; edit validates with the partial update schema
// and emits UpdateVehicleClassInput. Unlike the frozen Next form, the Vite
// operator portal drops the #407 operator picker entirely: an OPERATOR_* caller
// manages its own tenant, so the server infers operatorId from the session
// (resolveWriteOperatorId) and the field is omitted here.
type ClassFormBaseProps = {
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleClassInput>
  isSubmitting?: boolean
}
type ClassFormProps =
  | (ClassFormBaseProps & {
      mode?: 'create'
      onSubmit: (data: CreateVehicleClassInput) => Promise<void>
    })
  | (ClassFormBaseProps & {
      mode: 'edit'
      onSubmit: (data: UpdateVehicleClassInput) => Promise<void>
    })

// The ACRISS <select>'s "None" option has an empty value. Coerce it to null so
// the schema's .nullish() accepts it instead of failing the regex on ''.
function nullableString(v: unknown) {
  return v === '' || v == null ? null : v
}

const ACRISS_CODE_LIST = Object.keys(ACRISS_CODES) as (keyof typeof ACRISS_CODES)[]

export function ClassForm(props: ClassFormProps) {
  const { onCancel, defaultValues, isSubmitting } = props
  const mode = props.mode ?? 'create'
  const t = useTranslations('business.classes')
  // ACRISS labels live under the top-level `acriss.*` namespace.
  const tAcriss = useTranslations('acriss')
  // Luggage-size option labels live under the top-level `luggageSize.*` namespace.
  const tLuggage = useTranslations('luggageSize')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClassFormValues, unknown, ClassFormOutput>({
    resolver: zodResolver(
      mode === 'edit' ? updateVehicleClassSchema : createVehicleClassSchema,
    ) as Resolver<ClassFormValues, unknown, ClassFormOutput>,
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      seats: 5,
      luggageCapacity: 2,
      luggageSize: 'MEDIUM',
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
        // An empty Textarea submits "", not undefined. Coerce blank/whitespace
        // descriptions so the API stores "no description", not an empty string.
        const trimmed = data.description?.trim()
        const { description: _drop, ...rest } = data
        const payload = trimmed && trimmed.length > 0 ? { ...rest, description: trimmed } : rest
        await props.onSubmit(payload)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="class-name">{t('form.name')}</Label>
        <Input id="class-name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="class-slug">{t('form.slug')}</Label>
        <Input id="class-slug" placeholder={t('form.slugPlaceholder')} {...register('slug')} />
        <p className="mt-1 text-xs text-muted-foreground">{t('form.slugHint')}</p>
        {errors.slug && <p className="mt-1 text-sm text-destructive">{errors.slug.message}</p>}
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
          {errors.seats && <p className="mt-1 text-sm text-destructive">{errors.seats.message}</p>}
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
            <p className="mt-1 text-sm text-destructive">{errors.luggageCapacity.message}</p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="class-luggageSize">{t('form.luggageSize')}</Label>
        {/* No setValueAs/blank option here: the class size is REQUIRED (defaults
            to MEDIUM), unlike the per-vehicle override select in VehicleForm
            which carries a blank "inherit" option. Don't harmonize the two. */}
        <NativeSelect id="class-luggageSize" {...register('luggageSize')}>
          {LUGGAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {tLuggage(size)}
            </option>
          ))}
        </NativeSelect>
        {errors.luggageSize && (
          <p className="mt-1 text-sm text-destructive">{errors.luggageSize.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="class-transmission">{t('form.transmission')}</Label>
          <NativeSelect id="class-transmission" {...register('transmission')}>
            <option value="AUTO">{t('form.transmissionAuto')}</option>
            <option value="MANUAL">{t('form.transmissionManual')}</option>
          </NativeSelect>
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
        <NativeSelect
          id="class-acrissCode"
          {...register('acrissCode', { setValueAs: nullableString })}
        >
          <option value="">{t('form.acrissCodeNone')}</option>
          {ACRISS_CODE_LIST.map((code) => (
            <option key={code} value={code}>
              {tAcriss(code)}
            </option>
          ))}
        </NativeSelect>
        {errors.acrissCode && (
          <p className="mt-1 text-sm text-destructive">{errors.acrissCode.message}</p>
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
        <p className="mt-1 text-xs text-muted-foreground">{t('form.sortOrderHint')}</p>
        {errors.sortOrder && (
          <p className="mt-1 text-sm text-destructive">{errors.sortOrder.message}</p>
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
