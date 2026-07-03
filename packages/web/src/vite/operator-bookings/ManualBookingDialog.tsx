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
import { CustomerPicker } from '@/vite/operator-bookings/CustomerPicker'
import {
  type CalendarVehicle,
  type CustomerSearchResult,
  createManualBooking,
  invalidateBookingCaches,
} from '@/vite/operator-bookings/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
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
  /** #1260: the operator a picker admin is acting as. Binds the create + scopes the
   *  customer search to that operator (undefined for a tenant operator session). */
  readonly pickedOperatorId?: string | undefined
}

// #589 1d: the manual-booking form. A *controlled* dialog — the route lifts `open`
// so a header button and a calendar slot-click both drive it. The operator picks a
// vehicle + store, a pickup/return range, and a customer: either a brand-new
// *walk-in* (inline name + phone) or an *existing* renter found via CustomerPicker
// (slice 3). The customer source is a discriminated union, so the POSTed body
// carries renterId XOR walkInCustomer. Pickup and dropoff share one store (one-way
// rentals are a later track).
export function ManualBookingDialog({
  open,
  onOpenChange,
  vehicles,
  locations,
  csrfToken,
  initialRange,
  pickedOperatorId,
}: ManualBookingDialogProps) {
  const t = useTranslations('bookings.operator.newBooking')
  const queryClient = useQueryClient()

  const [vehicleId, setVehicleId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  // The customer source: a walk-in (inline name + phone) or an existing renter
  // picked by id. Modeled as a mode + optional selection so the POST body is the
  // matching arm of the discriminated union — never both, never neither.
  const [customerMode, setCustomerMode] = useState<'walk-in' | 'existing'>('walk-in')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null)
  // Minted per booking attempt (reset on each open) so a double-submit or network
  // retry REPLAYS server-side (booking-creation's idempotency guard) rather than
  // creating a second booking — the client `disabled` flag alone can't cover a
  // network-layer retry. Mirrors the renter wizard's per-mount key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const mutation = useMutation({
    mutationFn: () =>
      createManualBooking(
        {
          requestedVehicleId: vehicleId,
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
          startAt: parseJstDateTimeLocal(start).toISOString(),
          endAt: parseJstDateTimeLocal(end).toISOString(),
          customer:
            customerMode === 'existing' && selectedCustomer
              ? { kind: 'existing', renterId: selectedCustomer.id }
              : { kind: 'walk-in', name: name.trim(), phone: phone.trim() },
          idempotencyKey,
        },
        csrfToken,
        pickedOperatorId,
      ),
    onSuccess: () => {
      // A write invalidates the operator-bookings prefix + dashboard overview; the
      // calendar refetches and the new booking appears (no optimistic UI).
      invalidateBookingCaches(queryClient)
      onOpenChange(false)
    },
  })

  // Reset the form once each time the dialog opens — keyed on the open transition
  // via a ref, so a store-list refetch while the dialog is open never clobbers a
  // half-filled form. Defaults the vehicle/store to the first option (a one-option
  // list then submits in a click) and prefills the range from a clicked slot.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setVehicleId(vehicles[0]?.id ?? '')
      setLocationId(locations[0]?.id ?? '')
      setStart(initialRange ? formatJstDateTimeLocal(initialRange.start) : '')
      setEnd(initialRange ? formatJstDateTimeLocal(initialRange.end) : '')
      setName('')
      setPhone('')
      setCustomerMode('walk-in')
      setSelectedCustomer(null)
      setIdempotencyKey(crypto.randomUUID())
      mutation.reset()
    }
    wasOpen.current = open
  }, [open, vehicles, locations, initialRange, mutation.reset])

  // A walk-in needs name + phone; an existing customer needs a selection. The
  // vehicle/store/range are required either way.
  const hasCustomer =
    customerMode === 'existing' ? selectedCustomer !== null : Boolean(name.trim() && phone.trim())
  const canSubmit =
    Boolean(vehicleId && locationId && start && end) && hasCustomer && !mutation.isPending

  // No vehicle or no store means there is nothing to book against — the form would
  // render empty selects that can never satisfy `canSubmit`, leaving submit silently
  // disabled. Show guidance instead (review #589 1d MED-2).
  const hasInventory = vehicles.length > 0 && locations.length > 0

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    mutation.mutate()
  }

  // Switching customer source clears the other arm's inputs so a half-filled walk-in
  // never lingers behind an existing-customer selection (or vice versa). The POST
  // body is derived from the active arm, so this is UX hygiene, not a safety gate.
  function selectCustomerMode(mode: 'walk-in' | 'existing') {
    if (mode === customerMode) return
    setCustomerMode(mode)
    setName('')
    setPhone('')
    setSelectedCustomer(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>

        {hasInventory ? (
          <form onSubmit={handleSubmit}>
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

              <fieldset className="space-y-2">
                <legend className="block text-sm font-medium">{t('customerSectionLabel')}</legend>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={customerMode === 'walk-in' ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={customerMode === 'walk-in'}
                    onClick={() => selectCustomerMode('walk-in')}
                  >
                    {t('customerNewTab')}
                  </Button>
                  <Button
                    type="button"
                    variant={customerMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={customerMode === 'existing'}
                    onClick={() => selectCustomerMode('existing')}
                  >
                    {t('customerExistingTab')}
                  </Button>
                </div>
              </fieldset>

              {customerMode === 'walk-in' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="manual-name">{t('nameLabel')}</Label>
                    <Input
                      id="manual-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
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
                </>
              ) : (
                <CustomerPicker
                  selected={selectedCustomer}
                  onSelect={setSelectedCustomer}
                  pickedOperatorId={pickedOperatorId}
                />
              )}
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
        ) : (
          <>
            <p className="py-4 text-sm text-muted-foreground">{t('noInventory')}</p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t('cancel')}
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
