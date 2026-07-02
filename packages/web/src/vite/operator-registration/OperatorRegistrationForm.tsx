const SELECT_CLASS_NAME =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
} from '@kuruma/shared/enums'
import type { Locale } from '@kuruma/shared/i18n/locales'
import {
  type OperatorApplicationInput,
  operatorApplicationSchema,
} from '@kuruma/shared/validators/operator-application'
import { type Resolver, useForm } from 'react-hook-form'
import { useLocale, useTranslations } from 'use-intl'
import type { z } from 'zod'

// consent in the schema input is `true` (z.literal), but the checkbox starts unchecked.
// A dedicated form-values type widens consent to boolean so defaultValues can set false.
// The resolver still validates literal(true) at submit time — "no consent" is rejected.
type FormValues = Omit<z.input<typeof operatorApplicationSchema>, 'consent'> & {
  consent: boolean
}
type FormOutput = OperatorApplicationInput

interface OperatorRegistrationFormProps {
  onSubmit: (data: OperatorApplicationInput) => void | Promise<void>
  isSubmitting?: boolean
}

export function OperatorRegistrationForm({
  onSubmit,
  isSubmitting = false,
}: OperatorRegistrationFormProps) {
  const t = useTranslations('business.register.form')
  // useLocale() returns string; cast to the shared Locale SSoT this app supports.
  const locale = useLocale() as Locale

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(operatorApplicationSchema) as Resolver<FormValues, unknown, FormOutput>,
    defaultValues: {
      businessName: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      serviceArea: '',
      website: '',
      businessLicenseNumber: '',
      businessType: undefined,
      message: '',
      submittedLocale: locale,
      honeypot: '',
      consent: false,
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Anti-spam honeypot — visible to bots, hidden from real users via off-screen
          positioning. tabIndex -1 and aria-hidden prevent accidental interaction. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
      >
        <input type="text" tabIndex={-1} autoComplete="off" {...register('honeypot')} />
      </div>

      {/* submittedLocale is a hidden value derived from the active locale — no UI. */}
      <input type="hidden" {...register('submittedLocale')} />

      <div>
        <Label htmlFor="reg-businessName">{t('businessName')}</Label>
        <Input id="reg-businessName" {...register('businessName')} />
        {errors.businessName && (
          <p className="text-sm text-destructive mt-1">{errors.businessName.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-contactName">{t('contactName')}</Label>
        <Input id="reg-contactName" {...register('contactName')} />
        {errors.contactName && (
          <p className="text-sm text-destructive mt-1">{errors.contactName.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-contactEmail">{t('contactEmail')}</Label>
        <Input id="reg-contactEmail" type="email" {...register('contactEmail')} />
        {errors.contactEmail && (
          <p className="text-sm text-destructive mt-1">{errors.contactEmail.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-contactPhone">{t('contactPhone')}</Label>
        <Input id="reg-contactPhone" type="tel" {...register('contactPhone')} />
        {errors.contactPhone && (
          <p className="text-sm text-destructive mt-1">{errors.contactPhone.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-serviceArea">{t('serviceArea')}</Label>
        <Input id="reg-serviceArea" {...register('serviceArea')} />
        {errors.serviceArea && (
          <p className="text-sm text-destructive mt-1">{errors.serviceArea.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-fleetSize">{t('fleetSize')}</Label>
        <select
          id="reg-fleetSize"
          className={SELECT_CLASS_NAME}
          {...register('estimatedFleetSize')}
        >
          <option value="" />
          {OPERATOR_APPLICATION_FLEET_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        {errors.estimatedFleetSize && (
          <p className="text-sm text-destructive mt-1">{errors.estimatedFleetSize.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-website">{t('website')}</Label>
        <Input id="reg-website" type="url" {...register('website')} />
        {errors.website && (
          <p className="text-sm text-destructive mt-1">{errors.website.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-licenseNumber">{t('licenseNumber')}</Label>
        <Input id="reg-licenseNumber" {...register('businessLicenseNumber')} />
        {errors.businessLicenseNumber && (
          <p className="text-sm text-destructive mt-1">{errors.businessLicenseNumber.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-businessType">{t('businessType')}</Label>
        <select
          id="reg-businessType"
          className={SELECT_CLASS_NAME}
          {...register('businessType', { setValueAs: (v: string) => (v === '' ? undefined : v) })}
        >
          {/* Empty first option — blank value coerces to undefined via schema optional. */}
          <option value="" />
          {OPERATOR_APPLICATION_BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'INDIVIDUAL' ? t('individual') : t('company')}
            </option>
          ))}
        </select>
        {errors.businessType && (
          <p className="text-sm text-destructive mt-1">{errors.businessType.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="reg-message">{t('message')}</Label>
        <Textarea id="reg-message" {...register('message')} />
        {errors.message && (
          <p className="text-sm text-destructive mt-1">{errors.message.message}</p>
        )}
      </div>

      <div>
        {/* Wrapping label associates the checkbox without a separate htmlFor/id pair. */}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            aria-invalid={errors.consent ? true : undefined}
            {...register('consent')}
          />
          {t('consent')}
        </label>
        {errors.consent && (
          <p className="text-sm text-destructive mt-1">{errors.consent.message}</p>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </form>
  )
}
