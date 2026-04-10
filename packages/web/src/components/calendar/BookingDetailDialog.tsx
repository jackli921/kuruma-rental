'use client'

import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CalendarBooking } from '@/lib/calendar'
import { format } from 'date-fns'

interface BookingDetailDialogProps {
  readonly booking: CalendarBooking | null
  readonly onClose: () => void
}

export function BookingDetailDialog({ booking, onClose }: BookingDetailDialogProps) {
  return (
    <Dialog open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Booking Details</DialogTitle>
          <DialogDescription>
            {booking ? `Booking ${booking.id.slice(0, 8)}...` : ''}
          </DialogDescription>
        </DialogHeader>
        {booking && (
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <BookingStatusBadge status={booking.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Start</span>
              <span>{format(new Date(booking.startAt), 'MMM d, yyyy HH:mm')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">End</span>
              <span>{format(new Date(booking.endAt), 'MMM d, yyyy HH:mm')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Source</span>
              <span>{booking.source}</span>
            </div>
            {booking.notes && (
              <div>
                <span className="text-muted-foreground">Notes</span>
                <p className="mt-1">{booking.notes}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
