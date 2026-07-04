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
import { buildNameBundle } from '@/vite/operator-add-ons/name-bundle'
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
            // A row with a nameI18n bundle is SELF-AUTHORED (its name is editable, D5);
            // otherwise it is picked and the template name is fixed/read-only.
            editIdentity={addOn.nameI18n ? 'custom' : 'template'}
            templateName={addOn.resolvedName}
            onSubmit={async (data) => {
              // Price + the caller's UI-locale description slot always change (merged
              // into the raw bag so a sibling locale stays). A self-authored row ALSO
              // re-sends its name bundle so the operator can add ja/zh or fix en (D5);
              // a picked row never touches its (template-owned) name.
              const descriptionOverride = setLocaleSlot(
                addOn.descriptionOverride,
                locale,
                data.description,
              )
              await mutateAsync(
                data.identityMode === 'custom'
                  ? {
                      priceJpy: data.priceJpy,
                      descriptionOverride,
                      nameI18n: buildNameBundle(data.nameEn, data.nameJa, data.nameZh),
                    }
                  : { priceJpy: data.priceJpy, descriptionOverride },
              )
            }}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isPending}
            defaultValues={{
              identityMode: addOn.nameI18n ? 'custom' : 'template',
              templateId: addOn.templateId ?? '',
              nameEn: addOn.nameI18n?.en ?? '',
              nameJa: addOn.nameI18n?.ja ?? '',
              nameZh: addOn.nameI18n?.zh ?? '',
              priceJpy: addOn.priceJpy,
              description: addOn.descriptionOverride?.[locale] ?? '',
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
