import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { JST_TIME_ZONE } from '@/lib/datetime'
import { OPERATOR_BOOKINGS_KEY, deleteBlock } from '@/vite/operator-bookings/api'
import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

export interface BlockDetailDialogProps {
  /** The clicked block, or null when none is selected (the dialog is then closed). */
  readonly block: BlockCalendarEvent | null
  readonly onClose: () => void
  /** Resolved by the route from the block's `resourceId` (the calendar item carries
   *  only the vehicle id, never an enriched name). */
  readonly vehicleName: string | null
  /** Operator-session viewers manage blocks; a platform-admin manages blocks only
   *  within the operator it has picked (canManage folds that in). */
  readonly canManage: boolean
  readonly csrfToken: string
  /** #1260: the picked operator a platform-admin is acting as; the delete binds to
   *  it server-side. Undefined for a tenant operator (its own scope binds it). */
  readonly pickedOperatorId?: string | undefined
  readonly locale: string
}

// #1101 Slice B: view a scheduled block and (for operators) remove it. Controlled by
// the route's `selectedBlock` state — `open` is derived from `block !== null`. A hard
// delete behind a two-step confirm; on success it invalidates the operator-bookings
// prefix so the freed slot reappears. `createdBy` is intentionally not shown (design
// P2 — a raw audit id, not a display record).
export function BlockDetailDialog({
  block,
  onClose,
  vehicleName,
  canManage,
  csrfToken,
  pickedOperatorId,
  locale,
}: BlockDetailDialogProps) {
  const t = useTranslations('bookings.operator.blocks')
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const mutation = useMutation({
    mutationFn: () => {
      if (!block) throw new Error('no block selected')
      return deleteBlock(block.resourceId, block.id, csrfToken, pickedOperatorId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
      onClose()
    },
  })

  // The route remounts this per block (`key={block.id}`), so `confirming` + the
  // mutation start fresh for each opened block — no reset effect needed.
  if (!block) return null

  const culture = locale === 'zh' ? 'zh-CN' : locale
  // #1250: pin to JST so the window label matches the JST-placed band on the calendar
  // (block.start/end are true instants; the shared pin keeps every formatter aligned).
  const fmt = new Intl.DateTimeFormat(culture, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: JST_TIME_ZONE,
  })
  const windowLabel = `${fmt.format(block.start)} – ${fmt.format(block.end)}`

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('detail.dialogTitle')}</DialogTitle>
        </DialogHeader>

        <dl className="space-y-3 py-4 text-sm">
          <Row label={t('detail.vehicleLabel')}>{vehicleName ?? '—'}</Row>
          <Row label={t('detail.kindLabel')}>{t(`kinds.${block.kind}`)}</Row>
          <Row label={t('detail.windowLabel')}>{windowLabel}</Row>
          <Row label={t('detail.reasonLabel')}>{block.reason}</Row>
          {block.notes ? <Row label={t('detail.notesLabel')}>{block.notes}</Row> : null}
        </dl>

        {mutation.isError && (
          <output className="block text-sm text-destructive">{t('detail.deleteError')}</output>
        )}

        {canManage && confirming && (
          <p className="text-sm text-muted-foreground">{t('detail.deleteConfirm')}</p>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t('detail.close')}
          </DialogClose>
          {canManage &&
            (confirming ? (
              <Button
                type="button"
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {t('detail.deleteAction')}
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                {t('detail.deleteAction')}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
