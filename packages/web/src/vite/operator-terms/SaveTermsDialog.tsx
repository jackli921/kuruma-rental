import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { OperatorScope, WithOperatorId } from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { TermsForm } from './TermsForm'
import type { OperatorTermsVersionData } from './api'
import { OPERATOR_TERMS_QUERY_KEY, saveOperatorTermsDraft } from './api'
import type { TermsFormValues } from './name-bundle'

interface SaveTermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: OperatorScope
  // When set, the dialog edits this draft; otherwise it creates a new draft.
  draft?: OperatorTermsVersionData | undefined
}

function emptyValues(): TermsFormValues {
  return {
    titleEn: '',
    bodyEn: '',
    labelEn: '',
    titleJa: '',
    bodyJa: '',
    labelJa: '',
    titleZh: '',
    bodyZh: '',
    labelZh: '',
  }
}

function seedFromDraft(draft: OperatorTermsVersionData): TermsFormValues {
  return {
    // Seed English from the draft's en-resolved fields (Slice A: API
    // resolves/mirrors en into title/body/acceptanceLabel).
    titleEn: draft.title,
    bodyEn: draft.body,
    labelEn: draft.acceptanceLabel,
    // ja/zh seeding deferred to Slice B — the Slice A API response carries
    // only the resolved (en) fields, not raw locale buckets.
    titleJa: '',
    bodyJa: '',
    labelJa: '',
    titleZh: '',
    bodyZh: '',
    labelZh: '',
  }
}

export function SaveTermsDialog({ open, onOpenChange, scope, draft }: SaveTermsDialogProps) {
  const t = useTranslations('business.terms')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const [values, setValues] = useState<TermsFormValues>(() =>
    draft ? seedFromDraft(draft) : emptyValues(),
  )

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (input: WithOperatorId<SaveOperatorTermsDraftInput>) =>
      saveOperatorTermsDraft(input, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_TERMS_QUERY_KEY })
      onOpenChange(false)
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset()
      // Reset form to initial values when closing.
      setValues(draft ? seedFromDraft(draft) : emptyValues())
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(bundle: SaveOperatorTermsDraftInput) {
    const body: WithOperatorId<SaveOperatorTermsDraftInput> = scope.pickedOperatorId
      ? { ...bundle, operatorId: scope.pickedOperatorId }
      : bundle
    await mutateAsync(body)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft ? t('editDraft') : t('addOption')}</DialogTitle>
          <DialogDescription>{draft ? t('editSubtitle') : t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <TermsForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          onCancel={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
