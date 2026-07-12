import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  COMBO_QUERY_KEY,
  type ClassRatePlanData,
  removeComboDeal,
} from '@/vite/operator-combo-deals/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface RemoveComboDialogProps {
  deal: ClassRatePlanData | null
  onOpenChange: (open: boolean) => void
  /** Binds the DELETE to the picked operator via `?operatorId=`; omitted for an
   *  operator session (tenant-clamped server-side). */
  pickedOperatorId?: string | undefined
}

export function RemoveComboDialog({
  deal,
  onOpenChange,
  pickedOperatorId,
}: RemoveComboDialogProps) {
  const t = useTranslations('business.comboDeals')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: (id: string) => removeComboDeal(id, csrfToken, pickedOperatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // A hard delete failing leaves a "it failed" banner; clear it on close so
  // reopening the dialog for a different deal never shows the stale error.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  // Synchronous in-flight guard: isPending updates between renders, so two clicks
  // in the same frame both see false and fire delete twice. A ref flips
  // synchronously in onClick (mirrors ArchiveFeeDialog).
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  const name = deal?.label ?? ''

  return (
    <Dialog open={deal !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('removeTitle', { name })}</DialogTitle>
          <DialogDescription>{t('removeDescription')}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || deal == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !deal) return
              inFlightRef.current = true
              mutate(deal.id)
            }}
          >
            {isPending ? t('removing') : t('removeConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
