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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { selectSubstitutionCandidates } from '@/lib/substitution'
import { isOperatorSession } from '@/vite/guards'
import type { OperatorBookingDetailDto } from '@/vite/operator-bookings/api'
import {
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
  substituteBooking,
} from '@/vite/operator-bookings/api'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface SubstituteVehicleActionProps {
  readonly booking: OperatorBookingDetailDto
  readonly fleet: readonly OperatorFleetVehicle[]
  readonly session: Session | null
}

// Operator action: swap a broken/unavailable car for another of the same class
// at the same store (#610, screenshot step 8 — 故障车换同店同级别车，系统留痕). The
// server re-validates and writes the VEHICLE_SUBSTITUTED audit event, so on
// success we only invalidate the detail + events queries and the timeline
// reflects the swap. The candidate filter is the pure FC/IS core
// (selectSubstitutionCandidates) — the operator can never pick a car the POST
// would reject. Gated like every operator write surface (#581/#583/#598): only
// a tenant-scoped operator session writes; a bypass role (no operatorId) gets a
// read-only note, and a terminal booking explains the action is unavailable.
export function SubstituteVehicleAction({ booking, fleet, session }: SubstituteVehicleActionProps) {
  const t = useTranslations('bookings.operator')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [reason, setReason] = useState('')

  const canWrite = isOperatorSession(session)
  const isActionable = booking.status === 'CONFIRMED' || booking.status === 'ACTIVE'
  const csrfToken = session?.csrfToken ?? ''
  const candidates = selectSubstitutionCandidates(fleet, booking)

  const mutation = useMutation({
    mutationFn: (input: { newVehicleId: string; reason: string }) =>
      substituteBooking(booking.id, input.newVehicleId, input.reason, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: operatorBookingDetailQueryOptions(booking.id).queryKey,
      })
      queryClient.invalidateQueries({ queryKey: bookingEventsQueryOptions(booking.id).queryKey })
      setOpen(false)
      setSelectedId('')
      setReason('')
    },
  })

  if (!canWrite) {
    return <p className="text-sm text-muted-foreground">{t('substitute.readOnly')}</p>
  }
  if (!isActionable) {
    return <p className="text-sm text-muted-foreground">{t('substitute.unavailable')}</p>
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    mutation.mutate({ newVehicleId: selectedId, reason })
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('substitute.action')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setSelectedId('')
            setReason('')
            mutation.reset()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t('substitute.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('substitute.dialogDescription')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('substitute.noCandidates')}</p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-1 font-medium text-sm">{t('substitute.pickLabel')}</legend>
                  {candidates.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <input
                        type="radio"
                        name="substitute-candidate"
                        value={v.id}
                        checked={selectedId === v.id}
                        onChange={() => setSelectedId(v.id)}
                      />
                      <span>
                        {t('substitute.vehicleOption', {
                          name: v.name,
                          plate: v.licensePlate ?? t('none'),
                        })}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              <div className="space-y-2">
                <Label htmlFor="substitute-reason">{t('substitute.reasonLabel')}</Label>
                <Textarea
                  id="substitute-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('substitute.reasonPlaceholder')}
                />
              </div>

              {mutation.isError && (
                <output className="text-destructive text-sm">{t('substitute.error')}</output>
              )}
            </div>

            <DialogFooter>
              <DialogClose
                render={<Button type="button" variant="outline" disabled={mutation.isPending} />}
              >
                {t('substitute.cancel')}
              </DialogClose>
              <Button type="submit" disabled={!selectedId || mutation.isPending}>
                {t('substitute.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
