import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatJpy } from '@/lib/format'
import { SubstituteVehicleDialog } from '@/vite/operator-bookings/SubstituteVehicleDialog'
import {
  type OperatorBookingStatus,
  cancelBooking,
  updateBookingStatus,
} from '@/vite/operator-bookings/api'
import { actionsFor } from '@/vite/operator-bookings/booking-actions'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// #616 step 8 (管理订单): the operator's order-management panel on the trip-detail
// page. Buttons come from the pure `actionsFor` gate (state machine + the
// substitute/cancel exceptions), so they can't drift from the backend rules.
// Every state-changing action confirms first; cancel additionally surfaces the
// fee tier the server returns. No optimistic UI — the server CAS 409s a lost
// race, so we disable-while-pending and invalidate on success instead.
const OPERATOR_BOOKINGS_KEY = ['operator-bookings'] as const

type ConfirmKind = 'markActive' | 'markCompleted' | 'cancel'

interface BookingActionsPanelProps {
  readonly bookingId: string
  readonly status: OperatorBookingStatus
}

export function BookingActionsPanel({ bookingId, status }: BookingActionsPanelProps) {
  const t = useTranslations('bookings.operator.detail.actions')
  const queryClient = useQueryClient()
  const router = useRouter()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const actions = actionsFor(status)

  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const [substituteOpen, setSubstituteOpen] = useState(false)

  // Prefix-invalidate (list + calendar + badge + events) then re-run the loader
  // so the detail + timeline reflect the new state without a manual refresh.
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
    await router.invalidate()
  }

  const statusMutation = useMutation({
    mutationFn: (next: 'ACTIVE' | 'COMPLETED') => updateBookingStatus(bookingId, next, csrfToken),
    onSuccess: async () => {
      await refresh()
      setConfirm(null)
    },
  })
  const cancelMutation = useMutation({
    mutationFn: () => cancelBooking(bookingId, csrfToken),
    onSuccess: refresh, // keep the dialog open to show the returned fee tier
  })

  const isPending = statusMutation.isPending || cancelMutation.isPending
  const error = statusMutation.error ?? cancelMutation.error
  const cancelled = cancelMutation.data

  // Synchronous double-submit guard (mirrors AddOnArchiveDialog): isPending only
  // flips between renders, so two clicks in one frame both read false.
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) inFlightRef.current = false

  function closeConfirm() {
    setConfirm(null)
    statusMutation.reset()
    cancelMutation.reset()
  }

  function runConfirm() {
    if (inFlightRef.current || isPending || confirm == null) return
    inFlightRef.current = true
    if (confirm === 'cancel') cancelMutation.mutate()
    else statusMutation.mutate(confirm === 'markActive' ? 'ACTIVE' : 'COMPLETED')
  }

  const anyAction =
    actions.markActive || actions.markCompleted || actions.substitute || actions.cancel

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold">{t('heading')}</h2>

      {anyAction ? (
        <div className="flex flex-wrap gap-2">
          {actions.markActive && (
            <Button onClick={() => setConfirm('markActive')}>{t('markActive')}</Button>
          )}
          {actions.markCompleted && (
            <Button onClick={() => setConfirm('markCompleted')}>{t('markCompleted')}</Button>
          )}
          {actions.substitute && (
            <Button variant="outline" onClick={() => setSubstituteOpen(true)}>
              {t('substitute')}
            </Button>
          )}
          {actions.cancel && (
            <Button variant="destructive" onClick={() => setConfirm('cancel')}>
              {t('cancel')}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('terminal')}</p>
      )}

      <Dialog
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open) closeConfirm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm ? t(confirm) : ''}</DialogTitle>
            <DialogDescription>{confirm ? t(`${confirm}Confirm`) : ''}</DialogDescription>
          </DialogHeader>

          {cancelled ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t('cancelled')}</p>
              <p className="text-muted-foreground">
                {t('cancelTier', {
                  tier: cancelled.cancellation.tier,
                  fee: formatJpy(cancelled.cancellation.feeAmount),
                })}
              </p>
            </div>
          ) : null}

          {error && !cancelled && (
            <p className="px-1 text-sm text-destructive">
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}

          <DialogFooter>
            {cancelled ? (
              <Button onClick={closeConfirm}>{t('close')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeConfirm}>
                  {t('back')}
                </Button>
                <Button
                  variant={confirm === 'cancel' ? 'destructive' : 'default'}
                  disabled={isPending}
                  onClick={runConfirm}
                >
                  {isPending ? t('working') : t('confirm')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {actions.substitute && (
        <SubstituteVehicleDialog
          bookingId={bookingId}
          open={substituteOpen}
          onOpenChange={setSubstituteOpen}
        />
      )}
    </div>
  )
}
