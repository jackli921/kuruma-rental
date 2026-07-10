import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { type TermsFormValues, buildTermsBundle } from './name-bundle'

// Operator rental-terms authoring form (Slice A). Three locale fieldsets — en
// is required (the guaranteed fallback); ja/zh are nudged but never required.
// A locale is only included in the bundle when all three of its fields are
// non-blank (all-or-omit, see buildTermsBundle).

interface TermsFormProps {
  values: TermsFormValues
  onChange: (v: TermsFormValues) => void
  onSubmit: (bundle: SaveOperatorTermsDraftInput) => void
  isSubmitting: boolean
  onCancel: () => void
}

export function TermsForm({ values, onChange, onSubmit, isSubmitting, onCancel }: TermsFormProps) {
  const t = useTranslations('business.terms')
  const [enError, setEnError] = useState<string | null>(null)

  function set(key: keyof TermsFormValues) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange({ ...values, [key]: e.target.value })
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEnError(null)
    try {
      const bundle = buildTermsBundle(values)
      onSubmit(bundle)
    } catch (err) {
      if (err instanceof Error) {
        setEnError(err.message)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* English — required */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('form.localeEn')}</legend>

        <div>
          <Label htmlFor="terms-title-en">{t('form.docTitle')}</Label>
          <Input
            id="terms-title-en"
            value={values.titleEn}
            onChange={set('titleEn')}
            aria-invalid={enError ? true : undefined}
          />
        </div>

        <div>
          <Label htmlFor="terms-body-en">{t('form.body')}</Label>
          <Textarea
            id="terms-body-en"
            rows={6}
            value={values.bodyEn}
            onChange={set('bodyEn')}
            aria-invalid={enError ? true : undefined}
          />
        </div>

        <div>
          <Label htmlFor="terms-label-en">{t('form.acceptanceLabel')}</Label>
          <Input
            id="terms-label-en"
            value={values.labelEn}
            onChange={set('labelEn')}
            aria-invalid={enError ? true : undefined}
          />
        </div>

        {enError && <p className="text-sm text-destructive">{enError}</p>}
      </fieldset>

      {/* Japanese — optional */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('form.localeJa')}</legend>

        <div>
          <Label htmlFor="terms-title-ja">{t('form.docTitle')}</Label>
          <Input id="terms-title-ja" value={values.titleJa} onChange={set('titleJa')} />
        </div>

        <div>
          <Label htmlFor="terms-body-ja">{t('form.body')}</Label>
          <Textarea id="terms-body-ja" rows={6} value={values.bodyJa} onChange={set('bodyJa')} />
        </div>

        <div>
          <Label htmlFor="terms-label-ja">{t('form.acceptanceLabel')}</Label>
          <Input id="terms-label-ja" value={values.labelJa} onChange={set('labelJa')} />
        </div>
      </fieldset>

      {/* Chinese — optional */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('form.localeZh')}</legend>

        <div>
          <Label htmlFor="terms-title-zh">{t('form.docTitle')}</Label>
          <Input id="terms-title-zh" value={values.titleZh} onChange={set('titleZh')} />
        </div>

        <div>
          <Label htmlFor="terms-body-zh">{t('form.body')}</Label>
          <Textarea id="terms-body-zh" rows={6} value={values.bodyZh} onChange={set('bodyZh')} />
        </div>

        <div>
          <Label htmlFor="terms-label-zh">{t('form.acceptanceLabel')}</Label>
          <Input id="terms-label-zh" value={values.labelZh} onChange={set('labelZh')} />
        </div>
      </fieldset>

      {/* Nudge — shown once after all locale fieldsets */}
      <p className="text-xs text-muted-foreground">{t('form.localeNudge')}</p>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </form>
  )
}
