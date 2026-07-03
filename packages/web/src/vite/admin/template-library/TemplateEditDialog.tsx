import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSession } from '@/vite/session'
import type { TemplateAdminRow } from '@kuruma/shared/types/template-admin'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { TemplateFormFields } from './TemplateFormFields'
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
      <TemplateFormFields t={t} form={form} setForm={setForm} />

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
