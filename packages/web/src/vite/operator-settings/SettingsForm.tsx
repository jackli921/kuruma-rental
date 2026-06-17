import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type UpdateOperatorInput, updateOperatorSchema } from '@kuruma/shared/validators/operator'
import { type FormEvent, useState } from 'react'
import { useTranslations } from 'use-intl'

interface SettingsFormProps {
  defaultValues: { name: string; preAuthHandoffUrl: string | null }
  // Mirrors the API's OPERATOR_OWNER_WRITE_ROLES gate (#903): only an owner may
  // edit the renter-facing `preAuthHandoffUrl`. For a non-owner the field is
  // disabled AND its value is omitted from the patch — the API 403s any staff
  // request that names the field at all, even unchanged.
  canEditHandoff: boolean
  isSubmitting?: boolean
  onSubmit: (input: UpdateOperatorInput) => Promise<void>
}

export function SettingsForm({
  defaultValues,
  canEditHandoff,
  isSubmitting,
  onSubmit,
}: SettingsFormProps) {
  const t = useTranslations('business.settings')
  const [name, setName] = useState(defaultValues.name)
  const [handoff, setHandoff] = useState(defaultValues.preAuthHandoffUrl ?? '')
  // Required-but-nullable keys (not optional) so an explicit `undefined` reset is
  // legal under exactOptionalPropertyTypes.
  const [errors, setErrors] = useState<{
    name: string | undefined
    preAuthHandoffUrl: string | undefined
  }>({ name: undefined, preAuthHandoffUrl: undefined })

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    // 3-state on the handoff: an empty input clears it to null; a non-empty value
    // is sent verbatim (the schema enforces http(s)). A non-owner omits the key.
    const trimmedHandoff = handoff.trim()
    const input: UpdateOperatorInput = canEditHandoff
      ? { name, preAuthHandoffUrl: trimmedHandoff === '' ? null : trimmedHandoff }
      : { name }

    const parsed = updateOperatorSchema.safeParse(input)
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors
      setErrors({ name: fields.name?.[0], preAuthHandoffUrl: fields.preAuthHandoffUrl?.[0] })
      return
    }
    setErrors({ name: undefined, preAuthHandoffUrl: undefined })
    await onSubmit(parsed.data)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div>
        <Label htmlFor="settings-name">{t('form.name')}</Label>
        <Input
          id="settings-name"
          value={name}
          placeholder={t('form.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && <p className="text-sm text-destructive mt-1">{errors.name}</p>}
      </div>

      <div>
        <Label htmlFor="settings-handoff">{t('form.handoffUrl')}</Label>
        <Input
          id="settings-handoff"
          type="url"
          value={handoff}
          disabled={!canEditHandoff}
          placeholder={t('form.handoffUrlPlaceholder')}
          onChange={(e) => setHandoff(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">{t('form.handoffUrlHint')}</p>
        {!canEditHandoff && (
          <p className="text-xs text-muted-foreground mt-1">{t('form.handoffOwnerOnly')}</p>
        )}
        {errors.preAuthHandoffUrl && (
          <p className="text-sm text-destructive mt-1">{errors.preAuthHandoffUrl}</p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </form>
  )
}
