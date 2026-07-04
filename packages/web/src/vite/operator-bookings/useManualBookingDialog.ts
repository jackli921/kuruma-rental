import { useCallback, useMemo, useState } from 'react'

// #1246: manual (walk-in) booking dialog state, extracted from the /manage/bookings
// route (#1101 review). Owns the dialog's open flag and the optional slot prefill —
// a header-button open carries no range; a calendar slot-click prefills pickup/return.
export interface ManualBookingDialogApi {
  open: boolean
  setOpen: (open: boolean) => void
  slotRange: { start: Date; end: Date } | null
  openDialog: (range?: { start: Date; end: Date }) => void
}

export function useManualBookingDialog(): ManualBookingDialogApi {
  const [open, setOpen] = useState(false)
  // The clicked slot's range (null when opened from the header button), threaded to
  // the dialog so a slot-click prefills its pickup/return times.
  const [slotRange, setSlotRange] = useState<{ start: Date; end: Date } | null>(null)

  // Both the header button and a calendar slot-click open the dialog; a slot also
  // prefills the range (the button opens an empty range).
  const openDialog = useCallback((range?: { start: Date; end: Date }) => {
    setSlotRange(range ?? null)
    setOpen(true)
  }, [])

  return useMemo<ManualBookingDialogApi>(
    () => ({ open, setOpen, slotRange, openDialog }),
    [open, slotRange, openDialog],
  )
}
