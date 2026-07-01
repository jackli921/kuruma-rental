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
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  type SubstitutionCandidate,
  assignVehicle,
  invalidateBookingCaches,
} from '@/vite/operator-bookings/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslations } from 'use-intl'

interface AssignVehicleDialogProps {
  readonly bookingId: string
  /**
   * Candidates from GET /bookings/:id/substitution-candidates. For a float (no
   * assigned vehicle) this is the full same-operator / same-location / same-class
   * / AVAILABLE / road-legal set — exactly the vehicles the operator may pick.
   */
  readonly candidates: readonly SubstitutionCandidate[]
  /**
   * True when the candidate fetch errored. Without it an empty `candidates` from a
   * 403/500 is indistinguishable from a genuinely empty fleet.
   */
  readonly candidatesError?: boolean
  readonly csrfToken: string
}

// #464: assign a concrete vehicle to a CLASS_COMBO float booking. Mirrors
// SubstituteVehicleDialog exactly; only the endpoint and copy differ. On success
// it calls invalidateBookingCaches, whose operator-bookings prefix cascade covers
// the detail (assigned vehicle changes), events (VEHICLE_ASSIGNED audit row),
// needs-assignment worklist (booking no longer needs a car) and calendar (booking
// now occupies a column) — plus the dashboard overview (#1099 Theme 4).
// CSRF-gated; the session token rides the write.
export function AssignVehicleDialog({
  bookingId,
  candidates,
  candidatesError = false,
  csrfToken,
}: AssignVehicleDialogProps) {
  const t = useTranslations('bookings.operator.detail.assign')
  // Shared copy (candidate list labels, empty states, reason field) reuses the
  // substitute namespace — no duplicate keys added to messages/*.json.
  const tSub = useTranslations('bookings.operator.detail.substitute')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [vehicleId, setVehicleId] = useState('')
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => assignVehicle(bookingId, vehicleId, reason.trim() || null, csrfToken),
    onSuccess: () => {
      invalidateBookingCaches(queryClient)
      setOpen(false)
    },
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
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
                <Label htmlFor="assign-vehicle">{t('vehicleLabel')}</Label>
                <NativeSelect
                  id="assign-vehicle"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  {candidates.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.licensePlate ? `${v.name} — ${v.licensePlate}` : v.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-reason">{tSub('reasonLabel')}</Label>
                <Textarea
                  id="assign-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={tSub('reasonPlaceholder')}
                />
              </div>
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              {candidatesError ? tSub('loadError') : tSub('noCandidates')}
            </p>
          )}

          {mutation.isError && (
            <output className="block text-sm text-destructive">{t('error')}</output>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {tSub('cancel')}
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
