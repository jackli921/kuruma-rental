'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { VehicleClassData } from '@/modules/classes'
import type { LocationData } from '@/modules/locations'
import type { OperatorOption } from '@/modules/operators'
import { zodResolver } from '@hookform/resolvers/zod'
import { type CreateVehicleInput, createVehicleSchema } from '@kuruma/shared/validators/vehicle'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

type VehicleFormValues = z.input<typeof createVehicleSchema>

interface VehicleFormProps {
  onSubmit: (data: CreateVehicleInput) => Promise<void>
  onCancel?: () => void
  defaultValues?: Partial<CreateVehicleInput>
  isSubmitting?: boolean
  // Passed from the parent so the form stays a dumb presentational component;
  // the Fleet page fetches classes once and shares the cache across dialogs.
  classes?: readonly VehicleClassData[] | undefined
  // #435: storefronts the vehicle can be picked up from. Like classId, a
  // vehicle's pickup location must belong to its operator (composite FK), so
  // the picker is scoped to the chosen operator when the operator picker shows.
  locations?: readonly LocationData[] | undefined
  // #435 P2-1: in edit mode the operator is fixed and its picker is hidden, so
  // there is no watched operatorId to scope by. The edit dialog passes the
  // vehicle's immutable operatorId here so location options stay in-tenant.
  operatorId?: string | undefined
  // #407: operators the caller may create under. Supplied ONLY by the add
  // dialog (create mode); absent in edit mode (operator is immutable). With one
  // operator the picker is hidden and the id submitted silently; with 2+ the
  // admin must choose (gate before operator #2).
  operators?: readonly OperatorOption[] | undefined
  // #407 P2: set when the server rejected the create with OPERATOR_REQUIRED
  // (a second operator now exists). Forces the picker open with an inline
  // prompt even if the still-stale `operators` prop carries a single entry.
  operatorRequired?: boolean
}

export function VehicleForm({
  onSubmit,
  onCancel,
  defaultValues,
  isSubmitting,
  classes,
  locations,
  operatorId,
  operators,
  operatorRequired,
}: VehicleFormProps) {
  const t = useTranslations('business.vehicles')
  // Size adjectives (Small/Medium/Large) live in one shared namespace, reused by
  // the display cards too, so they are never duplicated per-form (#457).
  const tSize = useTranslations('luggageSize')

  const showOperatorPicker =
    (operators !== undefined && operators.length > 1) || operatorRequired === true

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: {
      name: '',
      description: '',
      seats: 5,
      transmission: 'AUTO',
      // #457: luggage override defaults to null (inherit the class default);
      // edit mode spreads the vehicle's own value (number/size or explicit null).
      luggageCapacity: null,
      luggageSize: null,
      fuelType: '',
      licensePlate: '',
      photos: [],
      // Issue #50: sensible defaults owner-side so create mode is pre-filled
      // with typical shop rules. Edit mode overrides via ...defaultValues
      // (even with null — spread preserves explicit nulls).
      minRentalHours: 4,
      maxRentalHours: 72,
      advanceBookingHours: null,
      classId: null,
      pickupLocationId: null,
      // #407: with a single operator, default it so the body always carries an
      // explicit operatorId; with 2+ leave blank to force a choice.
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
        setValue('classId', null)
        setValue('pickupLocationId', null)
      }
    }
  }, [operators, setValue, getValues])

  // #407: a vehicle's class must belong to its operator (composite FK). When the
  // picker is shown, scope class options to the chosen operator; otherwise show
  // all (single-operator or edit mode).
  const selectedOperatorId = watch('operatorId')
  const visibleClasses = showOperatorPicker
    ? (classes ?? []).filter((klass) => klass.operatorId === selectedOperatorId)
    : classes
  // #435: same composite-FK scoping as classes — a pickup location must belong
  // to one operator. In create mode that's the picked (or sole) operator; in
  // edit mode the picker is hidden, so scope by the vehicle's operatorId prop.
  const scopeOperatorId = showOperatorPicker ? selectedOperatorId : operatorId
  const scopedLocations =
    scopeOperatorId != null
      ? (locations ?? []).filter((loc) => loc.operatorId === scopeOperatorId)
      : locations
  // #435 P1-2: a vehicle can reference a since-archived location, absent from
  // the active-only list. Preserve it as an explicit option so an unmatched
  // <select> can't silently null the assignment on a normal save.
  const assignedLocationId = defaultValues?.pickupLocationId ?? null
  const assignedLocationMissing =
    assignedLocationId != null &&
    locations != null &&
    !(scopedLocations ?? []).some((loc) => loc.id === assignedLocationId)
  const showLocationPicker =
    (scopedLocations != null && scopedLocations.length > 0) || assignedLocationMissing

  const operatorField = register('operatorId', { required: t('form.operatorRequired') })

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

      {showOperatorPicker && (
        <div>
          <Label htmlFor="operatorId">{t('form.operator')}</Label>
          <select
            id="operatorId"
            aria-label={t('form.operator')}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...operatorField}
            onChange={(e) => {
              operatorField.onChange(e)
              // Operator changed: drop any class/location from the previous
              // operator so a cross-operator (FK-violating) id can never be submitted.
              setValue('classId', null)
              setValue('pickupLocationId', null)
            }}
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

      {/* Single-operator create: carry the id without a visible control so the
          one-click flow is unchanged while the body still names the operator.
          Suppressed once the picker is forced open (P2 OPERATOR_REQUIRED). */}
      {!showOperatorPicker && operators?.length === 1 && (
        <input type="hidden" {...register('operatorId')} />
      )}

      {visibleClasses && visibleClasses.length > 0 && (
        <div>
          <Label htmlFor="classId">{t('form.class')}</Label>
          <select
            id="classId"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('classId', {
              // Empty string ("Unassigned") submits as null to match the
              // nullable UUID validator. Any other value is the class UUID.
              setValueAs: (v) => (v === '' || v == null ? null : v),
            })}
          >
            <option value="">{t('form.classNone')}</option>
            {visibleClasses.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showLocationPicker && (
        <div>
          <Label htmlFor="pickupLocationId">{t('form.pickupLocation')}</Label>
          <select
            id="pickupLocationId"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('pickupLocationId', {
              // Empty string ("No pickup location") submits as null to match the
              // nullable UUID validator. Any other value is the location UUID.
              setValueAs: (v) => (v === '' || v == null ? null : v),
            })}
          >
            <option value="">{t('form.pickupLocationNone')}</option>
            {assignedLocationMissing && (
              <option value={assignedLocationId ?? ''}>{t('form.pickupLocationCurrent')}</option>
            )}
            {(scopedLocations ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="make">{t('form.make')}</Label>
          <Input id="make" placeholder={t('form.makePlaceholder')} {...register('make')} />
        </div>
        <div>
          <Label htmlFor="model">{t('form.model')}</Label>
          <Input id="model" placeholder={t('form.modelPlaceholder')} {...register('model')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="year">{t('form.year')}</Label>
          <Input
            id="year"
            type="number"
            placeholder={t('form.yearPlaceholder')}
            {...register('year', { setValueAs: nullableNumber })}
          />
          {errors.year && <p className="text-sm text-destructive mt-1">{errors.year.message}</p>}
        </div>
        <div>
          <Label htmlFor="color">{t('form.color')}</Label>
          <Input id="color" placeholder={t('form.colorPlaceholder')} {...register('color')} />
        </div>
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

      {/* Per-vehicle luggage override (#457). Both optional: blank inherits the
          class default (resolveLuggage falls back to `vehicle.x ?? class.x`). */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="luggageCapacity">{t('form.luggageCapacity')}</Label>
          <Input
            id="luggageCapacity"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={t('form.luggageInheritPlaceholder')}
            {...register('luggageCapacity', { setValueAs: nullableNumber })}
          />
          {errors.luggageCapacity && (
            <p className="text-sm text-destructive mt-1">{errors.luggageCapacity.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="luggageSize">{t('form.luggageSize')}</Label>
          <select
            id="luggageSize"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            {...register('luggageSize', {
              // Empty ("Inherit from class") submits as null so the vehicle
              // falls back to the class default size.
              setValueAs: (v) => (v === '' || v == null ? null : v),
            })}
          >
            <option value="">{t('form.luggageSizeInherit')}</option>
            <option value="SMALL">{tSize('SMALL')}</option>
            <option value="MEDIUM">{tSize('MEDIUM')}</option>
            <option value="LARGE">{tSize('LARGE')}</option>
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
          <Label htmlFor="licensePlate">{t('form.licensePlate')}</Label>
          <Input
            id="licensePlate"
            placeholder={t('form.licensePlatePlaceholder')}
            {...register('licensePlate')}
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

      {/* Compliance: shaken and insurance expiry tracking (#226) */}
      <div>
        <div className="text-sm font-medium mb-2">{t('form.complianceHeading')}</div>
        <p className="text-xs text-muted-foreground mb-3">{t('form.complianceHint')}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="shakenExpiryDate">{t('form.shakenExpiryDate')}</Label>
            <Input
              id="shakenExpiryDate"
              type="date"
              {...register('shakenExpiryDate', {
                setValueAs: (v) => (v === '' || v == null ? null : v),
              })}
            />
            {errors.shakenExpiryDate && (
              <p className="text-sm text-destructive mt-1">{errors.shakenExpiryDate.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="insuranceExpiryDate">{t('form.insuranceExpiryDate')}</Label>
            <Input
              id="insuranceExpiryDate"
              type="date"
              {...register('insuranceExpiryDate', {
                setValueAs: (v) => (v === '' || v == null ? null : v),
              })}
            />
            {errors.insuranceExpiryDate && (
              <p className="text-sm text-destructive mt-1">{errors.insuranceExpiryDate.message}</p>
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
