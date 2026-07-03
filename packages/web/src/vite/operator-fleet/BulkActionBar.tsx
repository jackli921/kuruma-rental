import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  type BulkVehicleStatus,
  FLEET_QUERY_KEY,
  bulkUpdateVehicleStatus,
} from '@/vite/operator-fleet/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactElement, useState } from 'react'
import { useTranslations } from 'use-intl'

interface BulkActionBarProps {
  /** Ids the parent has selected. The bar is controlled — it owns no selection state. */
  readonly selectedIds: string[]
  /** Called after a successful bulk update (parent clears selection + refetches its view). */
  readonly onDone: () => void
  /** Called when the operator dismisses the selection without acting. */
  readonly onClear: () => void
  // #1260: a picker-admin binds the bulk write to the operator it picked; undefined
  // for an operator session (the API scopes those by the session cookie).
  readonly pickedOperatorId?: string | undefined
}

/**
 * Controlled bulk-action bar for the Vite fleet list (#559). Selection state lives
 * in the parent (`selectedIds`); this component only renders the affordances and
 * fires the cookie-scoped `bulkUpdateVehicleStatus` mutation. On success it
 * invalidates the fleet query so the list refetches, then hands control back via
 * `onDone`. Mirrors the frozen Next.js bar but speaks `use-intl` + `string[]`.
 */
export function BulkActionBar({
  selectedIds,
  onDone,
  onClear,
  pickedOperatorId,
}: BulkActionBarProps): ReactElement | null {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()
  // Cookie writes need the double-submit CSRF token echoed in the header (#1304).
  const csrfToken = useSession().data?.csrfToken ?? ''
  const [pendingStatus, setPendingStatus] = useState<BulkVehicleStatus | null>(null)

  const mutation = useMutation({
    mutationFn: (status: BulkVehicleStatus) =>
      bulkUpdateVehicleStatus(selectedIds, status, csrfToken, pickedOperatorId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY })
      setPendingStatus(null)
      onDone()
    },
  })

  const count = selectedIds.length
  if (count === 0) return null

  function handleConfirm(): void {
    if (pendingStatus) mutation.mutate(pendingStatus)
  }

  function handleCancel(): void {
    setPendingStatus(null)
    mutation.reset()
  }

  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null
  const statusLabel =
    pendingStatus === 'AVAILABLE' ? t('status.AVAILABLE') : t('status.MAINTENANCE')

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('bulk.selectedCount', { count })}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClear}>
              {t('bulk.deselectAll')}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Button size="sm" onClick={() => setPendingStatus('AVAILABLE')}>
              {t('bulk.setAvailable')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPendingStatus('MAINTENANCE')}>
              {t('bulk.setMaintenance')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={pendingStatus !== null} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bulk.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('bulk.confirmMessage', { count, status: statusLabel })}
            </DialogDescription>
          </DialogHeader>
          {errorMessage && <p className="px-1 text-sm text-destructive">{errorMessage}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
              {t('form.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={mutation.isPending}>
              {mutation.isPending ? '...' : t('form.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
