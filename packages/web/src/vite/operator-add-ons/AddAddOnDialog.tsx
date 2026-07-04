import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEFAULT_LOCALE, isLocale } from '@/vite/i18n/locale'
import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'
import { ADDON_QUERY_KEY, type CreateAddOnInput, createAddOn } from '@/vite/operator-add-ons/api'
import { setLocaleSlot } from '@/vite/operator-add-ons/description-override'
import { buildNameBundle } from '@/vite/operator-add-ons/name-bundle'
import { addOnTemplatesQueryOptions } from '@/vite/operator-add-ons/templates-api'
import type { WithOperatorId } from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'use-intl'

interface AddAddOnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Set when a platform admin has picked a tenant. Merged into the create body so
  // the server's platformAdminCreateAddOnSchema (which requires operatorId) is
  // satisfied; an operator session leaves this undefined and is auto-scoped. It
  // also scopes the template picker's already-offered exclusion to that tenant.
  pickedOperatorId?: string | undefined
}

export function AddAddOnDialog({ open, onOpenChange, pickedOperatorId }: AddAddOnDialogProps) {
  const t = useTranslations('business.addOns')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const rawLocale = useLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  // Only fetch the picker while the dialog is open; the server resolves each name
  // to `locale` and drops templates this operator already offers.
  const { data: templates } = useQuery({
    ...addOnTemplatesQueryOptions(locale, pickedOperatorId),
    enabled: open,
  })

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: WithOperatorId<CreateAddOnInput>) => createAddOn(data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_QUERY_KEY })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addOption')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <AddOnForm
          mode="create"
          templates={templates ?? []}
          onSubmit={async (data) => {
            const descriptionOverride = setLocaleSlot(null, locale, data.description)
            // Exactly one identity: a custom item sends its own name bundle; a picked
            // one sends the template id. The server refine enforces the same rule.
            const body: CreateAddOnInput =
              data.identityMode === 'custom'
                ? {
                    nameI18n: buildNameBundle(data.nameEn, data.nameJa, data.nameZh),
                    priceJpy: data.priceJpy,
                    descriptionOverride,
                  }
                : { templateId: data.templateId, priceJpy: data.priceJpy, descriptionOverride }
            await mutateAsync(pickedOperatorId ? { ...body, operatorId: pickedOperatorId } : body)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
