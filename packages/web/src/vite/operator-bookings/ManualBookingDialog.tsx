import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslations } from 'use-intl'

export interface ManualBookingDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

// #589 1d: operator creates a manual booking (walk-in or existing customer). The
// dialog is *controlled* — the route lifts the open state so both the "New Booking"
// button and a calendar slot-click can drive it. The booking form (vehicle, time
// range, CustomerPicker) lands in the next slice; this shell establishes the
// controlled-dialog seam the route wires against.
export function ManualBookingDialog({ open, onOpenChange }: ManualBookingDialogProps) {
  const t = useTranslations('bookings.operator.newBooking')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t('cancel')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
