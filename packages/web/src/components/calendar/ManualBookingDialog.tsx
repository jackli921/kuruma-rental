'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookingSlotPicker,
  type BookingSlotPickerValue,
  INITIAL_BOOKING_SLOT_PICKER_VALUE,
} from './BookingSlotPicker'
import {
  CustomerPicker,
  type CustomerPickerValue,
  type CustomerResult,
  INITIAL_CUSTOMER_PICKER_VALUE,
} from './CustomerPicker'
import {
  checkAvailability,
  createManualBooking,
  quickCreateCustomer,
  searchCustomers,
} from './manual-booking-actions'

interface ManualBookingDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onBookingCreated: () => void
  readonly vehicles: FleetVehicleOverviewData[]
  readonly defaultVehicleId?: string | undefined
  readonly defaultStartAt?: string | undefined
}

const SEARCH_DEBOUNCE_MS = 300
const AVAILABILITY_DEBOUNCE_MS = 400

// Resolve either an existing selected customer or a just-created one to a
// renterId. Separated from React handlers so the submit flow stays flat —
// validate, resolve, POST, done.
async function resolveRenterId(
  customer: CustomerPickerValue,
  labels: {
    selectCustomer: string
    nameRequired: string
    contactRequired: string
  },
): Promise<{ ok: true; renterId: string } | { ok: false; error: string }> {
  if (customer.mode === 'search') {
    if (!customer.selectedCustomer) return { ok: false, error: labels.selectCustomer }
    return { ok: true, renterId: customer.selectedCustomer.id }
  }

  const draft = customer.newDraft
  if (!draft.name.trim()) return { ok: false, error: labels.nameRequired }
  if (!draft.email.trim() && !draft.phone.trim()) {
    return { ok: false, error: labels.contactRequired }
  }

  const input: { name: string; email?: string; phone?: string; language?: string } = {
    name: draft.name.trim(),
    language: draft.language,
  }
  if (draft.email.trim()) input.email = draft.email.trim()
  if (draft.phone.trim()) input.phone = draft.phone.trim()

  const result = await quickCreateCustomer(input)
  if (!result.success) return { ok: false, error: result.error }
  return { ok: true, renterId: result.data.id }
}

export function ManualBookingDialog({
  open,
  onClose,
  onBookingCreated,
  vehicles,
  defaultVehicleId,
  defaultStartAt,
}: ManualBookingDialogProps) {
  const t = useTranslations('business.bookings.manualBooking')

  const [customer, setCustomer] = useState<CustomerPickerValue>(INITIAL_CUSTOMER_PICKER_VALUE)
  const [slot, setSlot] = useState<BookingSlotPickerValue>(INITIAL_BOOKING_SLOT_PICKER_VALUE)

  const [searchResults, setSearchResults] = useState<readonly CustomerResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const availabilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sequence tokens: responses from a stale request are ignored. Prevents a
  // slow early fetch from clobbering a newer query after the user keeps typing.
  const searchSeqRef = useRef(0)
  const availabilitySeqRef = useRef(0)

  // Cancel any outstanding timers on unmount so late resolutions don't
  // setState on a torn-down component.
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      if (availabilityTimeoutRef.current) clearTimeout(availabilityTimeoutRef.current)
      searchSeqRef.current += 1
      availabilitySeqRef.current += 1
    }
  }, [])

  // Reset on open so stale state from a prior session doesn't leak in.
  useEffect(() => {
    if (!open) return
    setCustomer(INITIAL_CUSTOMER_PICKER_VALUE)
    setSlot({
      ...INITIAL_BOOKING_SLOT_PICKER_VALUE,
      vehicleId: defaultVehicleId ?? '',
      startAt: defaultStartAt ?? '',
    })
    setSearchResults([])
    setError(null)
    setAvailabilityError(null)
  }, [open, defaultVehicleId, defaultStartAt])

  const handleSearchQueryChange = useCallback((query: string) => {
    // Clear the selected customer mid-typing — the user is looking for someone else.
    setCustomer((c) => ({ ...c, searchQuery: query, selectedCustomer: null }))

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (query.length < 2) {
      setSearchResults([])
      return
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current
      setIsSearching(true)
      const result = await searchCustomers(query)
      if (seq !== searchSeqRef.current) return
      if (result.success) setSearchResults(result.data)
      setIsSearching(false)
    }, SEARCH_DEBOUNCE_MS)
  }, [])

  // Debounced availability check. Fires whenever vehicle + both dates are set;
  // drops stale responses via the sequence token. Empty/invalid states clear
  // the warning immediately (no waiting for a debounced success).
  useEffect(() => {
    const { vehicleId, startAt, endAt } = slot
    if (!vehicleId || !startAt || !endAt) {
      setAvailabilityError(null)
      return
    }

    if (availabilityTimeoutRef.current) clearTimeout(availabilityTimeoutRef.current)
    availabilityTimeoutRef.current = setTimeout(async () => {
      const seq = ++availabilitySeqRef.current
      const result = await checkAvailability(vehicleId, startAt, endAt)
      if (seq !== availabilitySeqRef.current) return
      if (result.success && !result.data.available) {
        setAvailabilityError(t('vehicleUnavailable'))
      } else {
        setAvailabilityError(null)
      }
    }, AVAILABILITY_DEBOUNCE_MS)
  }, [slot, t])

  async function handleSubmit() {
    setError(null)
    setIsSubmitting(true)

    try {
      const resolved = await resolveRenterId(customer, {
        selectCustomer: t('selectCustomer'),
        nameRequired: t('nameRequired'),
        contactRequired: t('contactRequired'),
      })
      if (!resolved.ok) {
        setError(resolved.error)
        return
      }

      if (!slot.vehicleId || !slot.startAt || !slot.endAt) {
        setError(t('fillAllFields'))
        return
      }

      const bookingInput: {
        vehicleId: string
        renterId: string
        startAt: string
        endAt: string
        notes?: string
      } = {
        vehicleId: slot.vehicleId,
        renterId: resolved.renterId,
        startAt: new Date(slot.startAt).toISOString(),
        endAt: new Date(slot.endAt).toISOString(),
      }
      if (slot.notes.trim()) bookingInput.notes = slot.notes.trim()

      const result = await createManualBooking(bookingInput)
      if (!result.success) {
        setError(result.error)
        return
      }

      onBookingCreated()
      onClose()
    } catch (err) {
      console.error(err)
      setError(t('unexpectedError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            onSearchQueryChange={handleSearchQueryChange}
            searchResults={searchResults}
            isSearching={isSearching}
          />
          <BookingSlotPicker
            value={slot}
            onChange={setSlot}
            vehicles={vehicles}
            availabilityError={availabilityError}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !!availabilityError}>
            {isSubmitting ? t('creating') : t('createBooking')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
