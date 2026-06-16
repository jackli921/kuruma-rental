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
import { formatJstDateTimeLocal, parseJstDateTimeLocal } from '@/lib/datetime'
import {
  type CalendarVehicle,
  OPERATOR_BOOKINGS_KEY,
  createManualBooking,
} from '@/vite/operator-bookings/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslations } from 'use-intl'

export interface ManualBookingDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly vehicles: readonly CalendarVehicle[]
  /** Operator pickup/return stores ({id,name}); the form uses one for both ends. */
  readonly locations: readonly { id: string; name: string }[]
  readonly csrfToken: string
  /** A clicked calendar slot, to prefill the pickup/return range (wall-clock JST). */
  readonly initialRange?: { start: Date; end: Date } | undefined
}

// #589 1d (slice 2): the walk-in manual-booking form. A *controlled* dialog — the
// route lifts `open` so a header button and a calendar slot-click both drive it.
// The operator picks a vehicle + store, a pickup/return range, and the customer's
// name + phone, then POSTs a source=MANUAL booking. The existing-customer search
// (CustomerPicker) is slice 3; today the customer is always a walk-in. Pickup and
// dropoff share one store (one-way rentals are a later track).
export function ManualBookingDialog({
  open,
  onOpenChange,
  vehicles,
  locations,
  csrfToken,
  initialRange,
}: ManualBookingDialogProps) {
  const t = useTranslations('bookings.operator.newBooking')
  const queryClient = useQueryClient()

  const [vehicleId, setVehicleId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createManualBooking(
        {
          requestedVehicleId: vehicleId,
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
          startAt: parseJstDateTimeLocal(start).toISOString(),
          endAt: parseJstDateTimeLocal(end).toISOString(),
          customer: { kind: 'walk-in', name: name.trim(), phone: phone.trim() },
        },
        csrfToken,
      ),
    onSuccess: () => {
      // A write invalidates the whole operator-bookings prefix; the calendar
      // refetches and the new booking appears (no optimistic UI).
      queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
      onOpenChange(false)
    },
  })

  // Reset the form whenever the dialog opens: default the vehicle/store to the
  // first option (a single-option list then submits in one click) and prefill the
  // range from a clicked slot. Depends only on the open/range transition — the
  // data props are referentially stable per open — so a reset never clobbers typing.
  useEffect(() => {
    if (!open) return
    setVehicleId(vehicles[0]?.id ?? '')
    setLocationId(locations[0]?.id ?? '')
    setStart(initialRange ? formatJstDateTimeLocal(initialRange.start) : '')
    setEnd(initialRange ? formatJstDateTimeLocal(initialRange.end) : '')
    setName('')
    setPhone('')
    mutation.reset()
  }, [open, initialRange, vehicles, locations, mutation.reset])

  const canSubmit =
    Boolean(vehicleId && locationId && start && end && name.trim() && phone.trim()) &&
    !mutation.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="manual-vehicle">{t('vehicleLabel')}</Label>
              <NativeSelect
                id="manual-vehicle"
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
              <Label htmlFor="manual-location">{t('locationLabel')}</Label>
              <NativeSelect
                id="manual-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="manual-start">{t('startLabel')}</Label>
                <Input
                  id="manual-start"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-end">{t('endLabel')}</Label>
                <Input
                  id="manual-end"
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-name">{t('nameLabel')}</Label>
              <Input id="manual-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-phone">{t('phoneLabel')}</Label>
              <Input
                id="manual-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          {mutation.isError && (
            <output className="block text-sm text-destructive">{t('error')}</output>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('cancel')}
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
