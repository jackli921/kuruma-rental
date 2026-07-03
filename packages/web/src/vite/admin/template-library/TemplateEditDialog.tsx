import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { useSession } from '@/vite/session'
import { CATALOG_TEMPLATE_STATUSES } from '@kuruma/shared/enums'
import { SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { TEMPLATE_LIBRARY_QUERY_KEY, type TemplateCatalog, updateTemplate } from './api'
import { type TemplateForm, buildTemplatePatch, formFromRow } from './patch-form'

interface TemplateEditDialogProps {
  readonly catalog: TemplateCatalog
  readonly row: TemplateAdminRow | null
  readonly onOpenChange: (open: boolean) => void
}

/**
 * Curate one template (#1319 slice 2). Self-contained like the operator dialogs:
 * owns the CSRF token, the mutation, and the cache invalidation. A single Save
 * both translates the name/description bundles AND promotes/archives via the
 * status select — promoting a backfill-minted ARCHIVED, en-only row is: add ja/zh,
 * switch status to Active, Save. Keyed by row so the form resets per template.
 */
export function TemplateEditDialog({ catalog, row, onOpenChange }: TemplateEditDialogProps) {
  const t = useTranslations('admin.templateLibrary')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATE_LIBRARY_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>{t('edit.description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="px-1 text-destructive text-sm">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {row && (
          <EditForm
            key={row.id}
            t={t}
            row={row}
            isSubmitting={isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={(form) =>
              mutate({ catalog, id: row.id, patch: buildTemplatePatch(form), csrfToken })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  t,
  row,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  readonly t: (key: string) => string
  readonly row: TemplateAdminRow
  readonly isSubmitting: boolean
  readonly onCancel: () => void
  readonly onSubmit: (form: TemplateForm) => void
}) {
  const [form, setForm] = useState<TemplateForm>(() => formFromRow(row))
  const nameMissing = form.name.en.trim() === ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!nameMissing) onSubmit(form)
      }}
      className="space-y-4"
    >
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
        <Label htmlFor="template-status">{t('edit.statusLabel')}</Label>
        <NativeSelect
          id="template-status"
          value={form.status}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              status: e.target.value as TemplateForm['status'],
            }))
          }
        >
          {CATALOG_TEMPLATE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status === 'ACTIVE' ? t('active') : t('archived')}
            </option>
          ))}
        </NativeSelect>
      </div>

      {nameMissing && <p className="text-destructive text-sm">{t('edit.nameEnRequired')}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('edit.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting || nameMissing}>
          {isSubmitting ? t('edit.saving') : t('edit.save')}
        </Button>
      </DialogFooter>
    </form>
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
  readonly setForm: (updater: (prev: TemplateForm) => TemplateForm) => void
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
