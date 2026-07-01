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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-error'
import { formatJstDateTimeLocal, parseJstDateTimeLocal } from '@/lib/datetime'
import {
  type CalendarVehicle,
  type CreateBlockInput,
  OPERATOR_BOOKINGS_KEY,
  createBlock,
} from '@/vite/operator-bookings/api'
import { VEHICLE_BLOCK_KINDS, type VehicleBlockKind } from '@kuruma/shared/enums'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

export interface ScheduleBlockDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly vehicles: readonly CalendarVehicle[]
  readonly csrfToken: string
  /** The clicked slot's vehicle (day view) — the form defaults to it, else the first car. */
  readonly initialVehicleId?: string | undefined
  /** A clicked slot's range, to prefill start/end (wall-clock JST). */
  readonly initialRange?: { start: Date; end: Date } | undefined
}

const HTTP_CONFLICT = 409

// #1101 Slice B: schedule a vehicle block. A *controlled* dialog (the route lifts
// `open`) so the header "Schedule block" button and a calendar slot-click both drive
// it — a slot prefills the vehicle + range. Validates against the shared create
// contract; a 409 (block-vs-block overlap) is surfaced as a friendly message rather
// than the generic error. On success it invalidates the operator-bookings prefix so
// the calendar refetches and the new band appears.
export function ScheduleBlockDialog({
  open,
  onOpenChange,
  vehicles,
  csrfToken,
  initialVehicleId,
  initialRange,
}: ScheduleBlockDialogProps) {
  const t = useTranslations('bookings.operator.blocks')
  const queryClient = useQueryClient()

  const [vehicleId, setVehicleId] = useState('')
  const [kind, setKind] = useState<VehicleBlockKind>('MAINTENANCE')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateBlockInput = {
        kind,
        reason: reason.trim(),
        startAt: parseJstDateTimeLocal(start).toISOString(),
        endAt: parseJstDateTimeLocal(end).toISOString(),
        // Omit notes entirely when blank — the shared schema is .strict() with an
        // optional notes; sending '' would be a needless empty string.
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
      return createBlock(vehicleId, input, csrfToken)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
      onOpenChange(false)
    },
  })

  // Reset once per open transition (ref-guarded) so a vehicle-list refetch while the
  // dialog is open never clobbers a half-filled form. Defaults the vehicle to the
  // clicked slot's car (else the first), and prefills the range from the slot.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setVehicleId(initialVehicleId ?? vehicles[0]?.id ?? '')
      setKind('MAINTENANCE')
      setStart(initialRange ? formatJstDateTimeLocal(initialRange.start) : '')
      setEnd(initialRange ? formatJstDateTimeLocal(initialRange.end) : '')
      setReason('')
      setNotes('')
      mutation.reset()
    }
    wasOpen.current = open
  }, [open, vehicles, initialVehicleId, initialRange, mutation.reset])

  const hasVehicles = vehicles.length > 0
  const canSubmit = Boolean(vehicleId && start && end && reason.trim()) && !mutation.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    mutation.mutate()
  }

  const isOverlap = mutation.error instanceof ApiError && mutation.error.status === HTTP_CONFLICT

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('schedule.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('schedule.dialogDescription')}</DialogDescription>
        </DialogHeader>

        {hasVehicles ? (
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="block-vehicle">{t('schedule.vehicleLabel')}</Label>
                <NativeSelect
                  id="block-vehicle"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor="block-kind">{t('schedule.kindLabel')}</Label>
                <NativeSelect
                  id="block-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as VehicleBlockKind)}
                >
                  {VEHICLE_BLOCK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="block-start">{t('schedule.startLabel')}</Label>
                  <Input
                    id="block-start"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="block-end">{t('schedule.endLabel')}</Label>
                  <Input
                    id="block-end"
                    type="datetime-local"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="block-reason">{t('schedule.reasonLabel')}</Label>
                <Input
                  id="block-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('schedule.reasonPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="block-notes">{t('schedule.notesLabel')}</Label>
                <Textarea
                  id="block-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {mutation.isError && (
              <output className="block text-sm text-destructive">
                {isOverlap ? t('schedule.overlapError') : t('schedule.error')}
              </output>
            )}

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t('schedule.cancel')}
              </DialogClose>
              <Button type="submit" disabled={!canSubmit}>
                {t('schedule.submit')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <p className="py-4 text-sm text-muted-foreground">{t('schedule.noVehicles')}</p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t('schedule.cancel')}
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
