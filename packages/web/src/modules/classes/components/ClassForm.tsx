'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { OperatorOption } from '@/modules/operators'
import { zodResolver } from '@hookform/resolvers/zod'
import { ACRISS_CODES } from '@kuruma/shared/acriss'
import {
  type CreateVehicleClassInput,
  type UpdateVehicleClassInput,
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { type Resolver, useForm } from 'react-hook-form'
import type { z } from 'zod'

type ClassFormValues = z.input<typeof createVehicleClassSchema>
type ClassFormOutput = z.output<typeof createVehicleClassSchema>

// #413: one form, two modes. Create validates with createVehicleClassSchema and
// emits CreateVehicleClassInput; edit validates with updateVehicleClassSchema
// (partial, no defaults, no operatorId) and emits UpdateVehicleClassInput. The
// discriminated union ties each mode to its onSubmit input type and keeps the
// #407 operator picker create-only — operatorId is not patchable, so edit mode
// never accepts or renders it.
type ClassFormBaseProps = {
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleClassInput>
  isSubmitting?: boolean
}
type ClassFormProps =
  | (ClassFormBaseProps & {
      mode?: 'create'
      onSubmit: (data: CreateVehicleClassInput) => Promise<void>
      // #407: operators the caller may create under. Supplied only by the add
      // dialog. One operator → hidden + submitted silently; 2+ → the admin must
      // choose (gate before operator #2).
      operators?: readonly OperatorOption[] | undefined
      // #407 P2: set when the server rejected the create with OPERATOR_REQUIRED
      // (a second operator now exists). Forces the picker open with an inline
      // prompt even if the still-stale `operators` prop carries a single entry.
      operatorRequired?: boolean
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
  // #407 picker inputs are create-only; edit mode never shows or syncs them.
  const operators = props.mode === 'edit' ? undefined : props.operators
  const operatorRequired = props.mode === 'edit' ? false : props.operatorRequired
  const t = useTranslations('business.classes')
  // ACRISS labels live under the top-level `acriss.*` namespace, not
  // `business.classes`, so resolve them through a separate translator.
  const tAcriss = useTranslations('acriss')
  // Luggage size adjectives are shared with the renter display cards (#457).
  const tSize = useTranslations('luggageSize')

  const showOperatorPicker =
    (operators !== undefined && operators.length > 1) || operatorRequired === true

  // MEDIUM 3: three-type-parameter useForm narrows the submit handler to the
  // schema's OUTPUT type (CreateVehicleClassInput) — no `as` at handleSubmit.
  // Edit reuses the same field shape with the partial update resolver; the lone
  // cast bridges that resolver's value type to the create shape.
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
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
      // #407: with a single operator default it so the body always names the
      // operator; with 2+ leave blank to force an explicit choice.
      operatorId: operators?.length === 1 ? operators[0]?.id : undefined,
      ...defaultValues,
    },
  })

  // #407 P1: keep operatorId in sync with the operators list, which loads
  // asynchronously (client query, `undefined` until resolved) and can change
  // while the dialog is open. Reading the default only at mount left operatorId
  // unset on a cold-load race (-> 422) and left a stale auto-default selected
  // on a 1->2 change (bypassing the explicit-choice gate).
  const prevOperatorCount = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!operators) return
    const count = operators.length
    const previousCount = prevOperatorCount.current
    prevOperatorCount.current = count
    if (count === 1) {
      setValue('operatorId', operators[0]?.id)
      return
    }
    if (count > 1) {
      const current = getValues('operatorId')
      const pickerJustAppeared = previousCount === undefined || previousCount <= 1
      const isValidChoice = operators.some((op) => op.id === current)
      if (pickerJustAppeared || !isValidChoice) {
        setValue('operatorId', '')
      }
    }
  }, [operators, setValue, getValues])

  const operatorField = register('operatorId', { required: t('form.operatorRequired') })

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        // MEDIUM 4: an empty Textarea submits `""`, not `undefined`. Coerce
        // blank/whitespace-only descriptions so the API receives "no
        // description" rather than an empty string value.
        const trimmed = data.description?.trim()
        const { description: _drop, ...rest } = data
        const payload = trimmed && trimmed.length > 0 ? { ...rest, description: trimmed } : rest
        // `payload` is the create OUTPUT shape (a structural superset of the
        // update input). Narrow on mode to call the correctly-typed onSubmit;
        // in edit mode the update resolver has already stripped operatorId.
        if (props.mode === 'edit') await props.onSubmit(payload)
        else await props.onSubmit(payload)
      })}
      className="space-y-4"
    >
      {showOperatorPicker && (
        <div>
          <Label htmlFor="class-operatorId">{t('form.operator')}</Label>
          <select
            id="class-operatorId"
            aria-label={t('form.operator')}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...operatorField}
          >
            <option value="">{t('form.operatorPlaceholder')}</option>
            {operators?.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
              </option>
            ))}
          </select>
          {operatorRequired && (
            <p className="text-sm text-destructive mt-1">{t('form.operatorRequired')}</p>
          )}
          {errors.operatorId && (
            <p className="text-sm text-destructive mt-1">{errors.operatorId.message}</p>
          )}
        </div>
      )}

      {/* Single-operator create: carry the id without a visible control.
          Suppressed once the picker is forced open (P2 OPERATOR_REQUIRED). */}
      {!showOperatorPicker && operators?.length === 1 && (
        <input type="hidden" {...register('operatorId')} />
      )}

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

      <div className="grid grid-cols-3 gap-4">
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
        <div>
          {/* #457: class default luggage size — inherited by vehicles that leave
              their per-vehicle override blank. Required; defaults to MEDIUM. */}
          <Label htmlFor="class-luggageSize">{t('form.luggageSize')}</Label>
          <select
            id="class-luggageSize"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('luggageSize')}
          >
            <option value="SMALL">{tSize('SMALL')}</option>
            <option value="MEDIUM">{tSize('MEDIUM')}</option>
            <option value="LARGE">{tSize('LARGE')}</option>
          </select>
          {errors.luggageSize && (
            <p className="text-sm text-destructive mt-1">{errors.luggageSize.message}</p>
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
