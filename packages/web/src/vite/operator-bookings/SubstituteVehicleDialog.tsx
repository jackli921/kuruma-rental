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
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
  substituteBooking,
} from '@/vite/operator-bookings/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslations } from 'use-intl'

interface SubstituteVehicleDialogProps {
  readonly bookingId: string
  /**
   * Replacement candidates from GET /bookings/:id/substitution-candidates — the
   * server has already matched them to the booking's operator + pickup location +
   * ACRISS code (#616/#621), so the operator can never pick an invalid car.
   */
  readonly candidates: readonly SubstitutionCandidate[]
  /**
   * True when the candidate fetch errored. Without it an empty `candidates` from a
   * 403/500 is indistinguishable from a genuinely empty fleet, so the dialog would
   * mislabel a load failure as "no same-class vehicle available".
   */
  readonly candidatesError?: boolean
  readonly csrfToken: string
}

// #610: operator vehicle substitution (故障车换同店同级别车，系统留痕). A dialog that
// swaps the booking's assigned car for another AVAILABLE same-class, same-location
// vehicle via POST /bookings/:id/substitute. The candidate list comes pre-matched
// from the server (#616 endpoint), so the operator can never pick an invalid car.
// On success it invalidates the detail (re-fetch the new vehicle) and events (the
// appended VEHICLE_SUBSTITUTED audit row) queries — the timeline renders the
// 系统留痕 automatically. CSRF-gated; the session token rides the write.
export function SubstituteVehicleDialog({
  bookingId,
  candidates,
  candidatesError = false,
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
                <NativeSelect
                  id="substitute-vehicle"
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
            <p className="py-4 text-sm text-muted-foreground">
              {candidatesError ? t('loadError') : t('noCandidates')}
            </p>
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
