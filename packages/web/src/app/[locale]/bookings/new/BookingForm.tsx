'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { type RentalRuleFailure, createBooking } from '@/lib/bookings'
import { formatDurationHours } from '@/lib/rental-rules-format'
import { checkRentalRules } from '@kuruma/shared/lib/rental-rules'
import { Car, Fuel, Settings2, Users, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useMemo, useState } from 'react'

interface VehicleInfo {
  id: string
  name: string
  photos?: string[]
  seats: number
  transmission: string
  fuelType: string | null
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
}

interface BookingFormProps {
  vehicle: VehicleInfo
  isAuthenticated: boolean
}

interface FormState {
  success?: boolean
  error?: string
  bookingId?: string
  rentalRule?: RentalRuleFailure
}

async function bookingAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const vehicleId = formData.get('vehicleId') as string
  const startAt = formData.get('startAt') as string
  const endAt = formData.get('endAt') as string

  const result = await createBooking({ vehicleId, startAt, endAt })
  return result
}

export function BookingForm({ vehicle, isAuthenticated }: BookingFormProps) {
  const t = useTranslations('bookings.new')
  const durationT = useTranslations('vehicles.detail.rentalRules')
  const router = useRouter()
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [state, formAction, isPending] = useActionState(bookingAction, {})

  const hasDates = startAt !== '' && endAt !== ''
  const primaryPhoto = vehicle.photos?.[0]
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')

  // Issue #65: inline rental-rules check. Uses the same helper the API
  // calls, with the client clock as `now` — good enough for a hint, not
  // authoritative (the server always re-checks). Recomputed on every
  // keystroke so the submit button flips the moment a rule is satisfied
  // or violated.
  const localRuleCheck = useMemo(() => {
    if (!hasDates) return null
    const start = new Date(startAt)
    const end = new Date(endAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    if (end <= start) return null
    return checkRentalRules(
      {
        minRentalHours: vehicle.minRentalHours,
        maxRentalHours: vehicle.maxRentalHours,
        advanceBookingHours: vehicle.advanceBookingHours,
      },
      start,
      end,
      new Date(),
    )
  }, [
    hasDates,
    startAt,
    endAt,
    vehicle.minRentalHours,
    vehicle.maxRentalHours,
    vehicle.advanceBookingHours,
  ])

  const unitT = (key: string, values: { count: number }) => durationT(key, values)

  function getRentalRuleMessage(code: RentalRuleFailure['code'], requiredHours: number): string {
    const duration = formatDurationHours(requiredHours, unitT)
    if (code === 'RENTAL_RULE_ADVANCE_BOOKING') {
      return t('rentalRuleViolation.advance', { duration })
    }
    if (code === 'RENTAL_RULE_MIN_DURATION') {
      return t('rentalRuleViolation.min', { duration })
    }
    return t('rentalRuleViolation.max', { duration })
  }

  // Priority: server-returned rental-rule error (stale state after submit)
  // is ignored if the user has since typed new dates and the local check
  // is clean. Otherwise prefer the local check so the message updates as
  // they adjust the picker.
  const activeRuleFailure =
    localRuleCheck && !localRuleCheck.ok
      ? { code: localRuleCheck.code, required: localRuleCheck.required }
      : state.rentalRule
        ? { code: state.rentalRule.code, required: state.rentalRule.required }
        : null

  const rentalRuleMessage = activeRuleFailure
    ? getRentalRuleMessage(activeRuleFailure.code, activeRuleFailure.required)
    : null

  // Redirect to confirmation page on success
  useEffect(() => {
    if (state.success && state.bookingId) {
      router.push(`/bookings/confirmation?bookingId=${state.bookingId}&vehicleId=${vehicle.id}`)
    }
  }, [state.success, state.bookingId, router, vehicle.id])

  return (
    <div className="space-y-6">
      {/* Vehicle info card */}
      <Card>
        <CardContent className="pt-2">
          <h2 className="text-lg font-medium mb-4">{t('vehicleInfo')}</h2>
          <div className="flex gap-4">
            {primaryPhoto ? (
              <div className="w-32 h-24 overflow-hidden rounded-lg bg-muted shrink-0">
                <img src={primaryPhoto} alt={vehicle.name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-32 h-24 overflow-hidden rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Car className="size-8 text-muted-foreground/30" />
              </div>
            )}
            <div className="space-y-2">
              <h3 className="text-base font-medium">{vehicle.name}</h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-4" />
                  {t('seats', { count: vehicle.seats })}
                </span>
                <span className="flex items-center gap-1">
                  <Settings2 className="size-4" />
                  {transmissionLabel}
                </span>
                {vehicle.fuelType && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-4" />
                    {vehicle.fuelType}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Date selection form */}
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="vehicleId" value={vehicle.id} />

        <div className="space-y-2">
          <Label htmlFor="startAt">{t('pickupDate')}</Label>
          <Input
            id="startAt"
            name="startAt"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="endAt">{t('returnDate')}</Label>
          <Input
            id="endAt"
            name="endAt"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            required
          />
        </div>

        {/* Availability status */}
        {!hasDates && <p className="text-sm text-muted-foreground">{t('selectDates')}</p>}

        {/* Rental rule violation — inline hint (#65). Takes precedence
            over the generic server error so the renter sees the specific
            reason their dates are rejected. */}
        {rentalRuleMessage && (
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <XCircle className="size-4 shrink-0" />
            {rentalRuleMessage}
          </div>
        )}

        {/* Generic server error — only shown when we don't have a more
            specific rental-rule message to display. */}
        {state.error && !rentalRuleMessage && (
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <XCircle className="size-4 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          className="w-full"
          disabled={!hasDates || !isAuthenticated || isPending || rentalRuleMessage !== null}
        >
          {isPending ? t('submitting') : t('confirmBooking')}
        </Button>
      </form>
    </div>
  )
}
