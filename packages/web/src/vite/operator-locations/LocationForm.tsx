import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  type CreateLocationInput,
  type UpdateLocationInput,
  createLocationSchema,
  updateLocationSchema,
} from '@kuruma/shared/validators/location'
import { useState } from 'react'
import { type Resolver, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import type { z } from 'zod'

type LocationFormValues = z.input<typeof createLocationSchema>
type LocationFormOutput = z.output<typeof createLocationSchema>

// #413: one form, two modes. Create validates with createLocationSchema and
// emits CreateLocationInput; edit validates with the no-default
// updateLocationSchema and emits UpdateLocationInput (a PATCH must not inject
// defaults). The discriminated union ties each mode to its onSubmit input type,
// so an edit dialog can't be wired to the create type.
type LocationFormBaseProps = {
  onCancel?: () => void
  defaultValues?: Partial<CreateLocationInput>
  isSubmitting?: boolean
}
type LocationFormProps =
  | (LocationFormBaseProps & {
      mode?: 'create'
      onSubmit: (data: CreateLocationInput) => Promise<void>
    })
  | (LocationFormBaseProps & {
      mode: 'edit'
      onSubmit: (data: UpdateLocationInput) => Promise<void>
    })

const DEFAULT_OPEN = '09:00'
const DEFAULT_CLOSE = '18:00'

export function LocationForm(props: LocationFormProps) {
  const { onCancel, defaultValues, isSubmitting } = props
  const mode = props.mode ?? 'create'
  const t = useTranslations('business.locations')

  // Three-type-parameter useForm narrows the submit handler to the schema's
  // OUTPUT type (CreateLocationInput) — no `as` at handleSubmit. The fields are
  // identical across modes (update is the same fields, partial + no defaults),
  // so register/errors stay typed to the create shape and only the resolver
  // swaps. The lone cast bridges the update resolver's value type to that shape.
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LocationFormValues, unknown, LocationFormOutput>({
    resolver: zodResolver(
      mode === 'edit' ? updateLocationSchema : createLocationSchema,
    ) as Resolver<LocationFormValues, unknown, LocationFormOutput>,
    defaultValues: {
      name: '',
      address: '',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
      ...defaultValues,
    },
  })

  // Operating hours is an optional nested object. The toggle keeps it `null`
  // until the operator opts in — a blank pair must never become an invalid
  // {openTime:'', closeTime:''} that the HH:mm regex would reject.
  const [hoursEnabled, setHoursEnabled] = useState(defaultValues?.operatingHours != null)
  const handleHoursToggle = (enabled: boolean) => {
    setHoursEnabled(enabled)
    setValue(
      'operatingHours',
      enabled ? { openTime: DEFAULT_OPEN, closeTime: DEFAULT_CLOSE } : null,
    )
  }

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        // `data` is the create OUTPUT shape (a structural superset). In edit
        // mode it also satisfies UpdateLocationInput (all-optional), so narrow
        // on mode to call the correctly-typed onSubmit without a cast.
        if (props.mode === 'edit') await props.onSubmit(data)
        else await props.onSubmit(data)
      })}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="location-name">{t('form.name')}</Label>
        <Input id="location-name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="location-address">{t('form.address')}</Label>
        <Textarea
          id="location-address"
          placeholder={t('form.addressPlaceholder')}
          {...register('address')}
        />
        {errors.address && (
          <p className="text-sm text-destructive mt-1">{errors.address.message}</p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={hoursEnabled}
            onChange={(e) => handleHoursToggle(e.target.checked)}
          />
          {t('form.setHours')}
        </label>
        <p className="text-xs text-muted-foreground mt-1">{t('form.hoursHint')}</p>
        {hoursEnabled && (
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <Label htmlFor="location-openTime">{t('form.openTime')}</Label>
              <Input id="location-openTime" type="time" {...register('operatingHours.openTime')} />
              {errors.operatingHours?.openTime && (
                <p className="text-sm text-destructive mt-1">
                  {errors.operatingHours.openTime.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="location-closeTime">{t('form.closeTime')}</Label>
              <Input
                id="location-closeTime"
                type="time"
                {...register('operatingHours.closeTime')}
              />
              {errors.operatingHours?.closeTime && (
                <p className="text-sm text-destructive mt-1">
                  {errors.operatingHours.closeTime.message}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="location-timezone">{t('form.timezone')}</Label>
          <Input id="location-timezone" placeholder="Asia/Tokyo" {...register('timezone')} />
          {errors.timezone && (
            <p className="text-sm text-destructive mt-1">{errors.timezone.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="location-turnaround">{t('form.turnaround')}</Label>
          <Input
            id="location-turnaround"
            type="number"
            min={0}
            {...register('defaultTurnaroundMinutes', { valueAsNumber: true })}
          />
          <p className="text-xs text-muted-foreground mt-1">{t('form.turnaroundHint')}</p>
          {errors.defaultTurnaroundMinutes && (
            <p className="text-sm text-destructive mt-1">
              {errors.defaultTurnaroundMinutes.message}
            </p>
          )}
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
