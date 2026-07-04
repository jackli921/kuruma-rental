import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ADDON_QUERY_KEY, type OperatorAddOnData, archiveAddOn } from '@/vite/operator-add-ons/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface AddOnArchiveDialogProps {
  addOn: OperatorAddOnData | null
  onOpenChange: (open: boolean) => void
  // #1456: the tenant a picker admin acts as; threaded as ?operatorId= so the API
  // binds the DELETE to it. Undefined for an operator session (auto-scoped).
  pickedOperatorId?: string | undefined
}

export function AddOnArchiveDialog({
  addOn,
  onOpenChange,
  pickedOperatorId,
}: AddOnArchiveDialogProps) {
  const t = useTranslations('business.addOns')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: (id: string) => archiveAddOn(id, csrfToken, pickedOperatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDON_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard: isPending updates between renders, so two
  // clicks in the same frame both see false and fire archive twice. A ref flips
  // synchronously in onClick (mirrors the frozen ArchiveLocationDialog).
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  return (
    <Dialog open={addOn !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { name: addOn?.resolvedName ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || addOn == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !addOn) return
              inFlightRef.current = true
              mutate(addOn.id)
            }}
          >
            {isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
