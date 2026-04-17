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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
// Native <select> used for vehicle/language pickers — simpler than base-ui Select for this use case
import { Textarea } from '@/components/ui/textarea'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
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

interface CustomerResult {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  language: string
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

  // Customer state
  const [customerMode, setCustomerMode] = useState<'search' | 'create'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newLanguage, setNewLanguage] = useState('en')

  // Booking state
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? '')
  const [startAt, setStartAt] = useState(defaultStartAt ?? '')
  const [endAt, setEndAt] = useState('')
  const [notes, setNotes] = useState('')

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the most recent search request. Responses with an older seq are
  // discarded so a slower earlier-fired request can't clobber a later one.
  const searchSeqRef = useRef(0)

  // Clear any pending timeout on unmount so late-resolving fetches don't
  // setState on a torn-down component.
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      searchSeqRef.current += 1
    }
  }, [])

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setCustomerMode('search')
      setSearchQuery('')
      setSearchResults([])
      setSelectedCustomer(null)
      setNewName('')
      setNewEmail('')
      setNewPhone('')
      setNewLanguage('en')
      setVehicleId(defaultVehicleId ?? '')
      setStartAt(defaultStartAt ?? '')
      setEndAt('')
      setNotes('')
      setError(null)
      setAvailabilityError(null)
    }
  }, [open, defaultVehicleId, defaultStartAt])

  // Debounced customer search with sequence-based response ordering.
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    setSelectedCustomer(null)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (value.length < 2) {
      setSearchResults([])
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current
      setIsSearching(true)
      const result = await searchCustomers(value)
      // Drop responses from superseded requests (stale query) or unmount.
      if (seq !== searchSeqRef.current) return
      if (result.success) setSearchResults(result.data)
      setIsSearching(false)
    }, 300)
  }, [])

  // Availability check when vehicle + dates change
  useEffect(() => {
    if (!vehicleId || !startAt || !endAt) {
      setAvailabilityError(null)
      return
    }
    let cancelled = false
    const check = async () => {
      const result = await checkAvailability(vehicleId, startAt, endAt)
      if (cancelled) return
      if (result.success && !result.data.available) {
        setAvailabilityError(t('vehicleUnavailable'))
      } else {
        setAvailabilityError(null)
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [vehicleId, startAt, endAt, t])

  async function handleSubmit() {
    setError(null)
    setIsSubmitting(true)

    try {
      let renterId: string

      if (customerMode === 'search') {
        if (!selectedCustomer) {
          setError(t('selectCustomer'))
          setIsSubmitting(false)
          return
        }
        renterId = selectedCustomer.id
      } else {
        if (!newName.trim()) {
          setError(t('nameRequired'))
          setIsSubmitting(false)
          return
        }
        if (!newEmail.trim() && !newPhone.trim()) {
          setError(t('contactRequired'))
          setIsSubmitting(false)
          return
        }
        const customerInput: { name: string; email?: string; phone?: string; language?: string } = {
          name: newName.trim(),
          language: newLanguage,
        }
        if (newEmail.trim()) customerInput.email = newEmail.trim()
        if (newPhone.trim()) customerInput.phone = newPhone.trim()
        const createResult = await quickCreateCustomer(customerInput)
        if (!createResult.success) {
          setError(createResult.error)
          setIsSubmitting(false)
          return
        }
        renterId = createResult.data.id
      }

      if (!vehicleId || !startAt || !endAt) {
        setError(t('fillAllFields'))
        setIsSubmitting(false)
        return
      }

      const bookingInput: {
        vehicleId: string
        renterId: string
        startAt: string
        endAt: string
        notes?: string
      } = {
        vehicleId,
        renterId,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      }
      if (notes.trim()) bookingInput.notes = notes.trim()
      const result = await createManualBooking(bookingInput)

      if (!result.success) {
        setError(result.error)
        setIsSubmitting(false)
        return
      }

      onBookingCreated()
      onClose()
    } catch {
      setError(t('unexpectedError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const availableVehicles = vehicles.filter((v) => v.status === 'AVAILABLE')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Customer Section */}
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium mb-1">{t('customer')}</legend>

            <div className="flex gap-2">
              <Button
                variant={customerMode === 'search' ? 'default' : 'outline'}
                size="sm"
                type="button"
                onClick={() => setCustomerMode('search')}
              >
                {t('searchExisting')}
              </Button>
              <Button
                variant={customerMode === 'create' ? 'default' : 'outline'}
                size="sm"
                type="button"
                onClick={() => setCustomerMode('create')}
              >
                {t('createNew')}
              </Button>
            </div>

            {customerMode === 'search' && (
              <div className="grid gap-2">
                <Input
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
                {isSearching && <p className="text-xs text-muted-foreground">{t('searching')}</p>}
                {searchResults.length > 0 && !selectedCustomer && (
                  <ul className="border rounded-md max-h-32 overflow-y-auto">
                    {searchResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                          onClick={() => {
                            setSelectedCustomer(c)
                            setSearchResults([])
                          }}
                        >
                          <span className="font-medium">{c.name ?? c.email ?? c.phone}</span>
                          {c.name && (
                            <span className="text-muted-foreground ml-2">{c.email ?? c.phone}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedCustomer && (
                  <div className="flex items-center justify-between bg-accent/50 rounded-md px-3 py-2 text-sm">
                    <span>
                      {selectedCustomer.name ?? selectedCustomer.email ?? selectedCustomer.phone}
                      {selectedCustomer.name && (
                        <span className="text-muted-foreground ml-2">
                          {selectedCustomer.email ?? selectedCustomer.phone}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setSelectedCustomer(null)
                        setSearchQuery('')
                      }}
                    >
                      {t('change')}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {customerMode === 'create' && (
              <div className="grid gap-2">
                <div>
                  <Label htmlFor="mb-name">{t('name')}</Label>
                  <Input
                    id="mb-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="mb-email">{t('email')}</Label>
                    <Input
                      id="mb-email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="mb-phone">{t('phone')}</Label>
                    <Input
                      id="mb-phone"
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="mb-lang">{t('language')}</Label>
                  <select
                    id="mb-lang"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newLanguage}
                    onChange={(e) => setNewLanguage(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="ja">Japanese</option>
                    <option value="zh">Chinese</option>
                  </select>
                </div>
              </div>
            )}
          </fieldset>

          {/* Booking Section */}
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium mb-1">{t('bookingDetails')}</legend>

            <div>
              <Label htmlFor="mb-vehicle">{t('vehicle')}</Label>
              <select
                id="mb-vehicle"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">{t('selectVehicle')}</option>
                {availableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.licensePlate ? `(${v.licensePlate})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="mb-start">{t('startAt')}</Label>
                <Input
                  id="mb-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="mb-end">{t('endAt')}</Label>
                <Input
                  id="mb-end"
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
            </div>

            {availabilityError && <p className="text-sm text-destructive">{availabilityError}</p>}

            <div>
              <Label htmlFor="mb-notes">{t('notes')}</Label>
              <Textarea
                id="mb-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPlaceholder')}
                rows={2}
              />
            </div>
          </fieldset>
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
