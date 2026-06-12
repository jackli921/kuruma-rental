import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  FLEET_QUERY_KEY,
  type OperatorFleetVehicle,
  type VehicleClassOption,
  createVehicle,
  updateVehicle,
} from '@/vite/operator-fleet/api'
import { zodResolver } from '@hookform/resolvers/zod'
import { type CreateVehicleInput, createVehicleSchema } from '@kuruma/shared/validators/vehicle'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

// Controlled Add/Edit vehicle form for the Vite operator-fleet shell (#555).
// Parent owns open/close and class fetching; this component owns only the field
// state + the create/update mutation. Operator and pickup-location pickers from
// the frozen Next form are intentionally omitted: the operator is derived from
// the session cookie server-side (the client never names a tenant — see api.ts),
// and locations are a later slice.
//
// CAVEAT (#528): the `classOptions` prop is fed by the parent's
// vehicleClassOptionsQueryOptions(), which currently reads the PUBLIC
// /vehicle-classes catalog (cross-operator), not a tenant-scoped list. A scoped
// /vehicle-classes/manage endpoint lands with #528; until then the dropdown can
// surface classes from other operators. We only consume the prop here.

// The form binds to the create schema's INPUT shape (pre-transform) for both
// modes; edit submits a partial of the same fields, so the wider create schema
// validates a superset safely. react-hook-form emits string values that the
// schema/setValueAs coerce to the parsed CreateVehicleInput on submit.
type VehicleFormValues = z.input<typeof createVehicleSchema>

interface VehicleFormProps {
  /** The vehicle to edit, or `null` for create mode. */
  readonly vehicle: OperatorFleetVehicle | null
  /** Class options for the dropdown (parent fetches; cross-tenant until #528). */
  readonly classOptions: readonly VehicleClassOption[]
  /** Called after a create/update mutation succeeds. */
  readonly onSaved: () => void
  /** Called when the user cancels without saving. */
  readonly onCancel: () => void
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs'

// Blank numeric inputs must submit `null` (not NaN/undefined) so the nullish
// validators accept a cleared field. Mirrors the frozen form's pricing pattern.
function nullableNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function emptyToNull(value: unknown): string | null {
  return value === '' || value == null ? null : (value as string)
}

// Project an existing vehicle onto the form's input fields. Numeric/date columns
// are stringified so the controlled inputs render their current values.
function defaultsFromVehicle(vehicle: OperatorFleetVehicle | null): Partial<VehicleFormValues> {
  if (vehicle == null) {
    return {
      name: '',
      description: '',
      seats: 5,
      transmission: 'AUTO',
      fuelType: '',
      licensePlate: '',
      photos: [],
      minRentalHours: 4,
      maxRentalHours: 72,
      advanceBookingHours: null,
      classId: null,
    }
  }
  return {
    name: vehicle.name,
    description: vehicle.description ?? '',
    seats: vehicle.seats,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuelType ?? '',
    licensePlate: vehicle.licensePlate ?? '',
    photos: vehicle.photos,
    classId: vehicle.classId,
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    year: vehicle.year,
    color: vehicle.color ?? '',
    dailyRateJpy: vehicle.dailyRateJpy,
    hourlyRateJpy: vehicle.hourlyRateJpy,
    minRentalHours: vehicle.minRentalHours,
    maxRentalHours: vehicle.maxRentalHours,
    advanceBookingHours: vehicle.advanceBookingHours,
    shakenExpiryDate: vehicle.shakenExpiryDate,
    insuranceExpiryDate: vehicle.insuranceExpiryDate,
  }
}

export function VehicleForm({ vehicle, classOptions, onSaved, onCancel }: VehicleFormProps) {
  const t = useTranslations('business.vehicles.form')
  const queryClient = useQueryClient()
  const isEditMode = vehicle != null

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VehicleFormValues, unknown, CreateVehicleInput>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: defaultsFromVehicle(vehicle),
  })

  const mutation = useMutation({
    mutationFn: (data: CreateVehicleInput) =>
      isEditMode ? updateVehicle(vehicle.id, data) : createVehicle(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY })
      onSaved()
    },
  })

  // zodResolver transforms before the submit handler runs, so `data` is already
  // the parsed CreateVehicleInput (the form's 3rd generic) — no cast needed.
  const submitErrorMessage = mutation.error?.message

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <div>
        <Label htmlFor="name">{t('name')}</Label>
        <Input id="name" placeholder={t('namePlaceholder')} {...register('name')} />
        {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="description">{t('description')}</Label>
        <Textarea
          id="description"
          placeholder={t('descriptionPlaceholder')}
          {...register('description')}
        />
      </div>

      {classOptions.length > 0 && (
        <div>
          <Label htmlFor="classId">{t('class')}</Label>
          <select
            id="classId"
            className={SELECT_CLASS}
            {...register('classId', { setValueAs: emptyToNull })}
          >
            <option value="">{t('classNone')}</option>
            {classOptions.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="make">{t('make')}</Label>
          <Input id="make" placeholder={t('makePlaceholder')} {...register('make')} />
        </div>
        <div>
          <Label htmlFor="model">{t('model')}</Label>
          <Input id="model" placeholder={t('modelPlaceholder')} {...register('model')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="year">{t('year')}</Label>
          <Input
            id="year"
            type="number"
            placeholder={t('yearPlaceholder')}
            {...register('year', { setValueAs: nullableNumber })}
          />
          {errors.year && <p className="mt-1 text-sm text-destructive">{errors.year.message}</p>}
        </div>
        <div>
          <Label htmlFor="color">{t('color')}</Label>
          <Input id="color" placeholder={t('colorPlaceholder')} {...register('color')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="seats">{t('seats')}</Label>
          <Input id="seats" type="number" {...register('seats', { valueAsNumber: true })} />
          {errors.seats && <p className="mt-1 text-sm text-destructive">{errors.seats.message}</p>}
        </div>
        <div>
          <Label htmlFor="transmission">{t('transmission')}</Label>
          <select id="transmission" className={SELECT_CLASS} {...register('transmission')}>
            <option value="AUTO">{t('transmissionAuto')}</option>
            <option value="MANUAL">{t('transmissionManual')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fuelType">{t('fuelType')}</Label>
          <Input id="fuelType" placeholder={t('fuelTypePlaceholder')} {...register('fuelType')} />
        </div>
        <div>
          <Label htmlFor="licensePlate">{t('licensePlate')}</Label>
          <Input
            id="licensePlate"
            placeholder={t('licensePlatePlaceholder')}
            {...register('licensePlate')}
          />
        </div>
      </div>

      <Separator />

      <div>
        <div className="mb-2 text-sm font-medium">{t('pricingHeading')}</div>
        <p className="mb-3 text-xs text-muted-foreground">{t('pricingHint')}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="dailyRateJpy">{t('dailyRate')}</Label>
            <Input
              id="dailyRateJpy"
              type="number"
              inputMode="numeric"
              min={0}
              {...register('dailyRateJpy', { setValueAs: nullableNumber })}
            />
            {errors.dailyRateJpy && (
              <p className="mt-1 text-sm text-destructive">{errors.dailyRateJpy.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="hourlyRateJpy">{t('hourlyRate')}</Label>
            <Input
              id="hourlyRateJpy"
              type="number"
              inputMode="numeric"
              min={0}
              {...register('hourlyRateJpy', { setValueAs: nullableNumber })}
            />
            {errors.hourlyRateJpy && (
              <p className="mt-1 text-sm text-destructive">{errors.hourlyRateJpy.message}</p>
            )}
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <div className="mb-2 text-sm font-medium">{t('rentalRulesHeading')}</div>
        <p className="mb-3 text-xs text-muted-foreground">{t('rentalRulesHint')}</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="minRentalHours">{t('minRentalHours')}</Label>
            <Input
              id="minRentalHours"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={t('minRentalHoursPlaceholder')}
              {...register('minRentalHours', { setValueAs: nullableNumber })}
            />
            {errors.minRentalHours && (
              <p className="mt-1 text-sm text-destructive">{errors.minRentalHours.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="maxRentalHours">{t('maxRentalHours')}</Label>
            <Input
              id="maxRentalHours"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={t('maxRentalHoursPlaceholder')}
              {...register('maxRentalHours', { setValueAs: nullableNumber })}
            />
            {errors.maxRentalHours && (
              <p className="mt-1 text-sm text-destructive">{errors.maxRentalHours.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="advanceBookingHours">{t('advanceBookingHours')}</Label>
            <Input
              id="advanceBookingHours"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={t('advanceBookingHoursPlaceholder')}
              {...register('advanceBookingHours', { setValueAs: nullableNumber })}
            />
            {errors.advanceBookingHours && (
              <p className="mt-1 text-sm text-destructive">{errors.advanceBookingHours.message}</p>
            )}
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <div className="mb-2 text-sm font-medium">{t('complianceHeading')}</div>
        <p className="mb-3 text-xs text-muted-foreground">{t('complianceHint')}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="shakenExpiryDate">{t('shakenExpiryDate')}</Label>
            <Input
              id="shakenExpiryDate"
              type="date"
              {...register('shakenExpiryDate', { setValueAs: emptyToNull })}
            />
            {errors.shakenExpiryDate && (
              <p className="mt-1 text-sm text-destructive">{errors.shakenExpiryDate.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="insuranceExpiryDate">{t('insuranceExpiryDate')}</Label>
            <Input
              id="insuranceExpiryDate"
              type="date"
              {...register('insuranceExpiryDate', { setValueAs: emptyToNull })}
            />
            {errors.insuranceExpiryDate && (
              <p className="mt-1 text-sm text-destructive">{errors.insuranceExpiryDate.message}</p>
            )}
          </div>
        </div>
      </div>

      {submitErrorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {submitErrorMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )
}
