import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { CATALOG_TEMPLATE_STATUSES } from '@kuruma/shared/enums'
import { SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import { useId } from 'react'
import { type TemplateForm, isCatalogTemplateStatus } from './patch-form'

type SetForm = (updater: (prev: TemplateForm) => TemplateForm) => void

/**
 * The shared body of the template create + edit forms (#1319): the two localized
 * bundle field-groups (name / description) plus the status select. Both dialogs
 * render this over their own `form`/`setForm` state and supply their own footer,
 * so the field markup and a11y wiring live in one place. `t` is scoped to
 * `admin.templateLibrary`; the labels reuse the slice-2 `edit.*` keys.
 */
export function TemplateFormFields({
  t,
  form,
  setForm,
}: {
  readonly t: (key: string) => string
  readonly form: TemplateForm
  readonly setForm: SetForm
}) {
  // Unique per mounted instance so the create + edit dialogs never collide on a
  // shared DOM id / label binding (they render the same component).
  const statusId = useId()
  return (
    <>
      <BundleFields
        legend={t('edit.nameSection')}
        field="name"
        form={form}
        setForm={setForm}
        requireEn
      />
      <BundleFields
        legend={t('edit.descriptionSection')}
        field="description"
        form={form}
        setForm={setForm}
      />

      <div className="space-y-1.5">
        <Label htmlFor={statusId}>{t('edit.statusLabel')}</Label>
        <NativeSelect
          id={statusId}
          value={form.status}
          onChange={(e) => {
            const { value } = e.target
            if (isCatalogTemplateStatus(value)) {
              setForm((prev) => ({ ...prev, status: value }))
            }
          }}
        >
          {CATALOG_TEMPLATE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status === 'ACTIVE' ? t('active') : t('archived')}
            </option>
          ))}
        </NativeSelect>
      </div>
    </>
  )
}

/** Three locale inputs for one bundle field (`name` | `description`), each with
 *  its own label so screen readers announce "Name (JA)" etc. */
function BundleFields({
  legend,
  field,
  form,
  setForm,
  requireEn = false,
}: {
  readonly legend: string
  readonly field: 'name' | 'description'
  readonly form: TemplateForm
  readonly setForm: SetForm
  readonly requireEn?: boolean
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="font-medium text-sm">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {SUPPORTED_LOCALES.map((locale) => (
          <div key={locale} className="space-y-1">
            <span aria-hidden className="block text-muted-foreground text-xs uppercase">
              {locale}
            </span>
            <Input
              // Unique accessible name per field+locale (e.g. "Name JA"); the
              // visible locale chip above is aria-hidden to avoid a duplicate.
              aria-label={`${legend} ${locale.toUpperCase()}`}
              value={form[field][locale]}
              required={requireEn && locale === 'en'}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  [field]: { ...prev[field], [locale]: e.target.value },
                }))
              }
            />
          </div>
        ))}
      </div>
    </fieldset>
  )
}
