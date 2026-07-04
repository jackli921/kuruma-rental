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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { TemplateFormFields } from './TemplateFormFields'
import { TEMPLATE_LIBRARY_QUERY_KEY, type TemplateCatalog, createTemplate } from './api'
import { type TemplateForm, buildTemplateCreate, emptyTemplateForm } from './patch-form'

interface TemplateCreateDialogProps {
  readonly catalog: TemplateCatalog
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

/**
 * Mint a new template into the active catalog (#1319 slice 3). Self-contained
 * like {@link TemplateEditDialog}: owns the CSRF token, the mutation, and the
 * cache invalidation. Reuses {@link TemplateFormFields} so create + edit share
 * one field layout. `key`ing the inner form by catalog + open resets it between
 * opens; the server derives the `key` and 409s a duplicate (surfaced inline).
 */
export function TemplateCreateDialog({ catalog, open, onOpenChange }: TemplateCreateDialogProps) {
  const t = useTranslations('admin.templateLibrary')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATE_LIBRARY_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="px-1 text-destructive text-sm">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {open && (
          <CreateForm
            key={catalog}
            t={t}
            isSubmitting={isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={(form) => {
              const body = buildTemplateCreate(form)
              if (body) mutate({ catalog, body, csrfToken })
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({
  t,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  readonly t: (key: string) => string
  readonly isSubmitting: boolean
  readonly onCancel: () => void
  readonly onSubmit: (form: TemplateForm) => void
}) {
  const [form, setForm] = useState<TemplateForm>(() => emptyTemplateForm())
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
          {isSubmitting ? t('create.submitting') : t('create.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}
