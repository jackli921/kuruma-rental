import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { useCallback, useMemo, useState } from 'react'

// #1246: scheduled-block dialog state (#1101), extracted from the /manage/bookings
// route. Owns two independent dialogs: a schedule (create) form — with an optional
// slot prefill (clicked vehicle + range) — and a click-to-view detail keyed on the
// selected block.
export interface BlockDialogsApi {
  scheduleOpen: boolean
  setScheduleOpen: (open: boolean) => void
  slotRange: { start: Date; end: Date } | null
  slotVehicleId: string | undefined
  openSchedule: () => void
  openScheduleForSlot: (range: { start: Date; end: Date }, vehicleId?: string) => void
  selectedBlock: BlockCalendarEvent | null
  selectBlock: (block: BlockCalendarEvent) => void
  closeDetail: () => void
}

export function useBlockDialogs(): BlockDialogsApi {
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [slotRange, setSlotRange] = useState<{ start: Date; end: Date } | null>(null)
  const [slotVehicleId, setSlotVehicleId] = useState<string | undefined>(undefined)
  const [selectedBlock, setSelectedBlock] = useState<BlockCalendarEvent | null>(null)

  // The header button opens the schedule dialog with no prefill (vehicle defaults to
  // the first car, empty range).
  const openSchedule = useCallback(() => {
    setSlotRange(null)
    setSlotVehicleId(undefined)
    setScheduleOpen(true)
  }, [])

  // A calendar slot-select prefills the schedule dialog with the clicked vehicle + range.
  const openScheduleForSlot = useCallback(
    (range: { start: Date; end: Date }, vehicleId?: string) => {
      setSlotRange(range)
      setSlotVehicleId(vehicleId)
      setScheduleOpen(true)
    },
    [],
  )

  const closeDetail = useCallback(() => setSelectedBlock(null), [])

  return useMemo<BlockDialogsApi>(
    () => ({
      scheduleOpen,
      setScheduleOpen,
      slotRange,
      slotVehicleId,
      openSchedule,
      openScheduleForSlot,
      selectedBlock,
      selectBlock: setSelectedBlock,
      closeDetail,
    }),
    [
      scheduleOpen,
      slotRange,
      slotVehicleId,
      openSchedule,
      openScheduleForSlot,
      selectedBlock,
      closeDetail,
    ],
  )
}
