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
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-error'
import { formatJpy } from '@/lib/format'
import { BOOKINGS_KEY, cancelBooking } from '@/vite/bookings/api'
import { buildCancellationPreview } from '@/vite/bookings/cancellation-preview'
import type { CancellationReason } from '@kuruma/shared/db/schema'
import { CANCELLATION_REASON_CODES, type CancellationReasonCode } from '@kuruma/shared/enums'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// Cap mirrors the server's cancellationReasonSchema (#868 3b) so the textarea can't
// submit a note the API would 400.
const NOTE_MAX = 500

interface CancelBookingDialogProps {
  readonly bookingId: string
  readonly csrfToken: string
  /** ISO pickup time — drives the fee tier and the no-show framing (#868 H2/H3). */
  readonly startAt: string
  /** Booking total in yen; `null` only for a not-yet-priced class booking (#464). */
  readonly totalPrice: number | null
  /** Operator name for the settlement advisory (#868 M5). */
  readonly operatorName: string | null
}

// #856: a renter cancels their own CONFIRMED booking. Wires to the SAME
// IDOR-sealed POST /bookings/:id/cancel the operator uses; the server applies the
// tiered fee (72h free / 48h 30% / 24h 70% / same-day 100%) and is authoritative.
// We preview that fee client-side from the shared schedule so the renter sees the
// cost BEFORE committing — the cancel() response only returns it AFTER mutating.
// Advisory only (#868 M5): the fee settles with the operator at pickup, nothing is
// charged online. On success (or a benign 409 = already cancelled) it invalidates
// the renter bookings prefix so the list + this page reflect the CANCELLED state.
export function CancelBookingDialog({
  bookingId,
  csrfToken,
  startAt,
  totalPrice,
  operatorName,
}: CancelBookingDialogProps) {
  const t = useTranslations('bookings.cancel')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // #868 3b: an OPTIONAL reason. No selection => no reason sent; the cancel never
  // depends on it. The freeform note only travels when a category is also chosen.
  const [reasonCode, setReasonCode] = useState<CancellationReasonCode | null>(null)
  const [note, setNote] = useState('')

  function settle() {
    queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY })
    setOpen(false)
  }

  const mutation = useMutation({
    mutationFn: (reason: CancellationReason | null) => cancelBooking(bookingId, csrfToken, reason),
    onSuccess: settle,
    onError: (error) => {
      // 409 = no longer cancellable: an operator-cancel (or a double-submit) got
      // there first. The renter's intent is already met, so refresh to the
      // CANCELLED state and close rather than surface a scary error.
      if (error instanceof ApiError && error.status === 409) settle()
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so two
  // clicks in one frame would both fire the destructive cancel. A ref flips
  // synchronously (mirrors the operator dialog / AddOnArchiveDialog).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      mutation.reset()
      setReasonCode(null)
      setNote('')
    }
  }

  function confirmCancel() {
    if (inFlightRef.current || mutation.isPending) return
    inFlightRef.current = true
    const reason: CancellationReason | null = reasonCode
      ? { code: reasonCode, note: note.trim() || null }
      : null
    mutation.mutate(reason)
  }

  // Price the cancellation as it stands right now — `new Date()` is read once per
  // render, display-only, never stored.
  const preview = buildCancellationPreview(new Date(startAt), new Date(), totalPrice ?? 0)
  // A benign 409 closes the dialog via settle(); the only error worth surfacing
  // here is a genuine failure the renter should retry.
  const isBenign409 = mutation.error instanceof ApiError && mutation.error.status === 409
  const showError = mutation.isError && !isBenign409

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t('action')}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          {preview.mode === 'no-show' ? (
            <p className="font-medium">
              {t('noShowNotice', { fee: formatJpy(preview.feeAmount) })}
            </p>
          ) : (
            <>
              <p className="font-medium">
                {t('feeLine', {
                  fee: formatJpy(preview.feeAmount),
                  percent: Math.round(preview.feePercentage * 100),
                })}
              </p>
              <p className="text-muted-foreground">
                {t('refundLine', { refund: formatJpy(preview.refundAmount) })}
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {t('advisory', { operator: operatorName ?? '' })}
          </p>
        </div>

        {/* #868 3b: optional reason capture — never gates the cancel. */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('reason.legend')}</legend>
          <div className="space-y-1.5">
            {CANCELLATION_REASON_CODES.map((code) => (
              <label key={code} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cancel-reason"
                  className="size-4"
                  checked={reasonCode === code}
                  onChange={() => setReasonCode(code)}
                />
                <span>{t(`reason.options.${code}`)}</span>
              </label>
            ))}
          </div>
          {reasonCode && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('reason.notePlaceholder')}
              aria-label={t('reason.noteLabel')}
              rows={2}
              maxLength={NOTE_MAX}
            />
          )}
        </fieldset>

        {showError && <output className="block text-sm text-destructive">{t('error')}</output>}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t('keep')}</DialogClose>
          <Button variant="destructive" disabled={mutation.isPending} onClick={confirmCancel}>
            {mutation.isPending ? t('pending') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
