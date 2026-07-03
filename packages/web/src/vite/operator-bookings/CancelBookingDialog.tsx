import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cancelBooking, invalidateBookingCaches } from '@/vite/operator-bookings/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

interface CancelBookingDialogProps {
  readonly bookingId: string
  readonly csrfToken: string
  /** #1361: the operator a picker admin has chosen — threaded into the cancel write
   *  so the #1260 guard binds to it; undefined for a tenant operator. */
  readonly pickedOperatorId?: string | undefined
}

// #616: operator cancels a booking. The server applies the tiered cancellation
// fee (72h free / 48h 30% / 24h 70% / same-day 100%) and appends a
// BOOKING_CANCELLED audit event, so the action is irreversible and may charge the
// renter — hence the confirmation gate. On success it calls
// invalidateBookingCaches so the detail + timeline reflect the CANCELLED state and
// the dashboard overview drops the trip (#1099 Theme 4).
// CSRF-gated; the session token rides the write.
export function CancelBookingDialog({
  bookingId,
  csrfToken,
  pickedOperatorId,
}: CancelBookingDialogProps) {
  const t = useTranslations('bookings.operator.detail.cancelBooking')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: () => cancelBooking(bookingId, csrfToken, pickedOperatorId),
    onSuccess: () => {
      invalidateBookingCaches(queryClient)
      setOpen(false)
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so two
  // clicks in the same frame would both fire cancel. A ref flips synchronously
  // (mirrors AddOnArchiveDialog) — important here because the action is destructive.
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) mutation.reset()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t('action')}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>

        {mutation.isError && (
          <output className="block text-sm text-destructive">{t('error')}</output>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t('keep')}</DialogClose>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => {
              if (inFlightRef.current || mutation.isPending) return
              inFlightRef.current = true
              mutation.mutate()
            }}
          >
            {mutation.isPending ? t('pending') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
