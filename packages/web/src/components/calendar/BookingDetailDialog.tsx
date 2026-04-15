'use client'

import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CalendarBooking } from '@/lib/calendar'
import { formatJpy } from '@/lib/format'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { format } from 'date-fns'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { cancelBooking, updateBookingStatus } from './calendar-actions'

interface BookingDetailDialogProps {
  readonly booking: CalendarBooking | null
  readonly onClose: () => void
  readonly onBookingUpdate?: (updated: CalendarBooking) => void
}

export function BookingDetailDialog({
  booking,
  onClose,
  onBookingUpdate,
}: BookingDetailDialogProps) {
  const t = useTranslations('business.bookings.calendar')
  const tCommon = useTranslations('common')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // Reset state when a different booking is selected.
  // Uses a ref to track the previous booking ID and reset inline
  // (avoids useEffect with "unnecessary" deps that biome flags).
  const [prevBookingId, setPrevBookingId] = useState<string | null>(null)
  if (booking?.id !== prevBookingId) {
    setPrevBookingId(booking?.id ?? null)
    if (isSubmitting) setIsSubmitting(false)
    if (error) setError(null)
    if (showCancelConfirm) setShowCancelConfirm(false)
  }

  async function handleStatusTransition(newStatus: 'ACTIVE' | 'COMPLETED') {
    if (!booking) return
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await updateBookingStatus(booking.id, newStatus)
      if (!result.success) {
        setError(result.error)
        return
      }
      onBookingUpdate?.({ ...booking, status: newStatus })
      onClose()
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!booking) return
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await cancelBooking(booking.id)
      if (!result.success) {
        setError(result.error)
        return
      }
      onBookingUpdate?.({ ...booking, status: 'CANCELLED' })
      onClose()
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancellation =
    booking?.status === 'CONFIRMED' && booking.totalPrice != null
      ? calculateCancellationFee(new Date(booking.startAt), new Date(), booking.totalPrice)
      : null

  return (
    <Dialog open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {booking?.renterName ?? booking?.renterEmail ?? t('bookingDetails')}
          </DialogTitle>
          <DialogDescription>
            {booking
              ? `${format(new Date(booking.startAt), 'MMM d')} - ${format(new Date(booking.endAt), 'MMM d, yyyy')}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {booking && (
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('status')}</span>
              <BookingStatusBadge status={booking.status} />
            </div>

            {booking.renterEmail && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('email')}</span>
                <span className="truncate ml-4">{booking.renterEmail}</span>
              </div>
            )}

            {booking.renterLanguage && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('language')}</span>
                <Badge variant="outline">{booking.renterLanguage.toUpperCase()}</Badge>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('start')}</span>
              <span>{format(new Date(booking.startAt), 'MMM d, yyyy HH:mm')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('end')}</span>
              <span>{format(new Date(booking.endAt), 'MMM d, yyyy HH:mm')}</span>
            </div>

            {booking.totalPrice != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('totalPrice')}</span>
                <span className="font-medium">{formatJpy(booking.totalPrice)}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('source')}</span>
              <span>{booking.source}</span>
            </div>
            {booking.notes && (
              <div>
                <span className="text-muted-foreground">{t('notes')}</span>
                <p className="mt-1">{booking.notes}</p>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <DialogFooter>
          {booking?.status === 'CONFIRMED' && !showCancelConfirm && (
            <>
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(true)}
                disabled={isSubmitting}
              >
                {t('cancelBooking')}
              </Button>
              <Button onClick={() => handleStatusTransition('ACTIVE')} disabled={isSubmitting}>
                {isSubmitting ? t('starting') : t('startTrip')}
              </Button>
            </>
          )}

          {booking?.status === 'CONFIRMED' && showCancelConfirm && (
            <div className="w-full space-y-3">
              <p className="text-sm">{t('cancelConfirm')}</p>
              {cancellation &&
                (cancellation.tier === 'FREE' ? (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {t('freeCancellation')}
                  </p>
                ) : (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>{t('cancellationFee')}</span>
                      <span>{formatJpy(cancellation.feeAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('refundAmount')}</span>
                      <span>{formatJpy(cancellation.refundAmount)}</span>
                    </div>
                  </div>
                ))}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isSubmitting}
                >
                  {tCommon('back')}
                </Button>
                <Button variant="destructive" onClick={handleCancel} disabled={isSubmitting}>
                  {isSubmitting ? t('cancelling') : t('cancelBooking')}
                </Button>
              </div>
            </div>
          )}

          {booking?.status === 'ACTIVE' && (
            <Button onClick={() => handleStatusTransition('COMPLETED')} disabled={isSubmitting}>
              {isSubmitting ? t('completing') : t('completeTrip')}
            </Button>
          )}

          {(booking?.status === 'COMPLETED' || booking?.status === 'CANCELLED') && (
            <Button variant="outline" onClick={onClose}>
              {t('close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
