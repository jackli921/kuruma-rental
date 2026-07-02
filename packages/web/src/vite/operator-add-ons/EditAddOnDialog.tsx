import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEFAULT_LOCALE, isLocale } from '@/vite/i18n/locale'
import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'
import {
  ADDON_QUERY_KEY,
  type OperatorAddOnData,
  type UpdateAddOnInput,
  updateAddOn,
} from '@/vite/operator-add-ons/api'
import { setLocaleSlot } from '@/vite/operator-add-ons/description-override'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'use-intl'

interface EditAddOnDialogProps {
  addOn: OperatorAddOnData | null
  onOpenChange: (open: boolean) => void
}

export function EditAddOnDialog({ addOn, onOpenChange }: EditAddOnDialogProps) {
  const t = useTranslations('business.addOns')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const rawLocale = useLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (data: UpdateAddOnInput) => updateAddOn(addOn?.id ?? '', data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={addOn !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editOption')}</DialogTitle>
          <DialogDescription>{addOn?.resolvedName}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {addOn && (
          <AddOnForm
            key={addOn.id}
            mode="edit"
            templateName={addOn.resolvedName}
            onSubmit={async (data) => {
              // The template is fixed on edit; only the price and the caller's UI-locale
              // description slot change. Merge the slot into the raw override bag so a
              // sibling locale the operator authored is preserved.
              await mutateAsync({
                priceJpy: data.priceJpy,
                descriptionOverride: setLocaleSlot(
                  addOn.descriptionOverride,
                  locale,
                  data.description,
                ),
              })
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              templateId: addOn.templateId ?? '',
              priceJpy: addOn.priceJpy,
              description: addOn.descriptionOverride?.[locale] ?? '',
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
