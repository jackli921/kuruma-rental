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

// The field names that render a localized error message. The raw Zod message is
// English-only, so we surface a per-field localized string keyed under
// `business.register.form.errors.*` instead (finding #5). One message per field
// (not per Zod code) keeps it robust: "valid email" covers both empty and
// malformed, so the copy stays right regardless of which rule tripped.
type ErrorableField =
  | 'businessName'
  | 'contactName'
  | 'contactPhone'
  | 'serviceArea'
  | 'estimatedFleetSize'
  | 'website'
  | 'businessLicenseNumber'
  | 'message'
  | 'consent'

const errorDomId = (field: ErrorableField) => `reg-${field}-error`

interface OperatorRegistrationFormProps {
  onSubmit: (data: OperatorApplicationInput) => void | Promise<void>
  // The signed-in account's email — shown read-only (sign-in-first, #877). It is
  // NOT a form field: the server derives the authoritative applicant email from the
  // session, so it never rides in the submit payload.
  accountEmail: string
  isSubmitting?: boolean
}

export function OperatorRegistrationForm({
  onSubmit,
  accountEmail,
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

  // The a11y wiring a field with a validation error needs (#6): flag it invalid
  // and point assistive tech at the message element that describes why. Takes the
  // RHF error as `unknown` — only its presence matters, and RHF's per-field error
  // shape varies (plain vs Merge) across field kinds.
  const invalidProps = (field: ErrorableField, error: unknown) =>
    error ? { 'aria-invalid': true as const, 'aria-describedby': errorDomId(field) } : {}

  // The localized error message element (#5/#6). Rendered only when the field has
  // an error; carries the id `aria-describedby` above references, and role=alert so
  // the message is announced when it appears.
  const fieldError = (field: ErrorableField, error: unknown) =>
    error ? (
      <p id={errorDomId(field)} role="alert" className="text-sm text-destructive mt-1">
        {t(`errors.${field}`)}
      </p>
    ) : null

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
        <Input
          id="reg-businessName"
          aria-required
          {...invalidProps('businessName', errors.businessName)}
          {...register('businessName')}
        />
        {fieldError('businessName', errors.businessName)}
      </div>

      <div>
        <Label htmlFor="reg-contactName">{t('contactName')}</Label>
        <Input
          id="reg-contactName"
          aria-required
          {...invalidProps('contactName', errors.contactName)}
          {...register('contactName')}
        />
        {fieldError('contactName', errors.contactName)}
      </div>

      {/* Sign-in-first (#877): the applicant email is the signed-in account's email,
          shown read-only. It is NOT registered with RHF and never enters the submit
          payload — the server derives it authoritatively from the session. */}
      <div>
        <Label htmlFor="reg-accountEmail">{t('accountEmail')}</Label>
        {/* readOnly (not disabled): the field is never RHF-registered, so it stays
            out of the payload regardless, and readOnly keeps it in the a11y tree so
            the label + hint are announced (a disabled input is skipped by most SRs). */}
        <Input
          id="reg-accountEmail"
          type="email"
          value={accountEmail}
          readOnly
          aria-describedby="reg-accountEmail-hint"
        />
        <p id="reg-accountEmail-hint" className="text-sm text-muted-foreground mt-1">
          {t('accountEmailHint')}
        </p>
      </div>

      <div>
        <Label htmlFor="reg-contactPhone">{t('contactPhone')}</Label>
        <Input
          id="reg-contactPhone"
          type="tel"
          aria-required
          {...invalidProps('contactPhone', errors.contactPhone)}
          {...register('contactPhone')}
        />
        {fieldError('contactPhone', errors.contactPhone)}
      </div>

      <div>
        <Label htmlFor="reg-serviceArea">{t('serviceArea')}</Label>
        <Input
          id="reg-serviceArea"
          aria-required
          {...invalidProps('serviceArea', errors.serviceArea)}
          {...register('serviceArea')}
        />
        {fieldError('serviceArea', errors.serviceArea)}
      </div>

      <div>
        <Label htmlFor="reg-fleetSize">{t('fleetSize')}</Label>
        <select
          id="reg-fleetSize"
          className={SELECT_CLASS_NAME}
          aria-required
          {...invalidProps('estimatedFleetSize', errors.estimatedFleetSize)}
          {...register('estimatedFleetSize')}
        >
          {/* Labelled placeholder (#11): an empty first option that reads as a
              prompt for screen readers instead of a blank line. */}
          <option value="">{t('fleetSizePlaceholder')}</option>
          {OPERATOR_APPLICATION_FLEET_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        {fieldError('estimatedFleetSize', errors.estimatedFleetSize)}
      </div>

      <div>
        <Label htmlFor="reg-website">{t('website')}</Label>
        <Input
          id="reg-website"
          type="url"
          {...invalidProps('website', errors.website)}
          {...register('website')}
        />
        {fieldError('website', errors.website)}
      </div>

      <div>
        <Label htmlFor="reg-licenseNumber">{t('licenseNumber')}</Label>
        <Input
          id="reg-licenseNumber"
          {...invalidProps('businessLicenseNumber', errors.businessLicenseNumber)}
          {...register('businessLicenseNumber')}
        />
        {fieldError('businessLicenseNumber', errors.businessLicenseNumber)}
      </div>

      <div>
        <Label htmlFor="reg-businessType">{t('businessType')}</Label>
        <select
          id="reg-businessType"
          className={SELECT_CLASS_NAME}
          {...register('businessType', { setValueAs: (v: string) => (v === '' ? undefined : v) })}
        >
          {/* Labelled placeholder — optional field, so blank coerces to undefined. */}
          <option value="">{t('businessTypePlaceholder')}</option>
          {OPERATOR_APPLICATION_BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'INDIVIDUAL' ? t('individual') : t('company')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="reg-message">{t('message')}</Label>
        <Textarea
          id="reg-message"
          {...invalidProps('message', errors.message)}
          {...register('message')}
        />
        {fieldError('message', errors.message)}
      </div>

      <div>
        {/* Wrapping label associates the checkbox without a separate htmlFor/id pair. */}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? errorDomId('consent') : undefined}
            {...register('consent')}
          />
          {t('consent')}
        </label>
        {fieldError('consent', errors.consent)}
      </div>

      <div className="flex justify-end pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </form>
  )
}
