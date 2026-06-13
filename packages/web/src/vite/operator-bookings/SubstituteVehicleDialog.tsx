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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
  substituteBooking,
} from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslations } from 'use-intl'

interface SubstituteVehicleDialogProps {
  readonly bookingId: string
  /** Replacement candidates, already filtered to the booking's class + location. */
  readonly candidates: readonly OperatorFleetVehicle[]
  readonly csrfToken: string
}

// #610: operator vehicle substitution (故障车换同店同级别车，系统留痕). A dialog that
// swaps the booking's assigned car for another AVAILABLE same-class, same-location
// vehicle via POST /bookings/:id/substitute. The candidate list is pre-filtered by
// the page to mirror the server's rules exactly, so the operator can never pick an
// invalid car. On success it invalidates the detail (re-fetch the new vehicle) and
// events (the appended VEHICLE_SUBSTITUTED audit row) queries — the timeline renders
// the 系统留痕 automatically. CSRF-gated; the session token rides the write.
export function SubstituteVehicleDialog({
  bookingId,
  candidates,
  csrfToken,
}: SubstituteVehicleDialogProps) {
  const t = useTranslations('bookings.operator.detail.substitute')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [vehicleId, setVehicleId] = useState('')
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => substituteBooking(bookingId, vehicleId, reason.trim() || null, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: operatorBookingDetailQueryOptions(bookingId).queryKey,
      })
      queryClient.invalidateQueries({ queryKey: bookingEventsQueryOptions(bookingId).queryKey })
      setOpen(false)
    },
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      // Default to the first candidate so a single-option list submits in one click.
      setVehicleId(candidates[0]?.id ?? '')
      setReason('')
      mutation.reset()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!vehicleId || mutation.isPending) return
    mutation.mutate()
  }

  const hasCandidates = candidates.length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t('action')}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          {hasCandidates ? (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="substitute-vehicle">{t('vehicleLabel')}</Label>
                <select
                  id="substitute-vehicle"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {candidates.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.licensePlate ? `${v.name} — ${v.licensePlate}` : v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="substitute-reason">{t('reasonLabel')}</Label>
                <Textarea
                  id="substitute-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('reasonPlaceholder')}
                />
              </div>
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">{t('noCandidates')}</p>
          )}

          {mutation.isError && (
            <output className="block text-sm text-destructive">{t('error')}</output>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('cancel')}
            </DialogClose>
            <Button type="submit" disabled={!hasCandidates || !vehicleId || mutation.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
