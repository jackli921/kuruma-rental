'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { createBooking } from '@/lib/bookings'
import { Car, Fuel, Settings2, Users, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'

interface VehicleInfo {
  id: string
  name: string
  photos: string[]
  seats: number
  transmission: string
  fuelType: string | null
}

interface BookingFormProps {
  vehicle: VehicleInfo
  isAuthenticated: boolean
}

interface FormState {
  success?: boolean
  error?: string
  bookingId?: string
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
  const router = useRouter()
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [state, formAction, isPending] = useActionState(bookingAction, {})

  const hasDates = startAt !== '' && endAt !== ''
  const primaryPhoto = vehicle.photos[0]
  const transmissionLabel = vehicle.transmission === 'AUTO' ? t('auto') : t('manual')

  // Redirect to confirmation page on success
  if (state.success && state.bookingId) {
    router.push(`/bookings/confirmation?bookingId=${state.bookingId}&vehicleId=${vehicle.id}`)
  }

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

        {/* Error message */}
        {state.error && (
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <XCircle className="size-4 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          className="w-full"
          disabled={!hasDates || !isAuthenticated || isPending}
        >
          {isPending ? t('submitting') : t('confirmBooking')}
        </Button>
      </form>
    </div>
  )
}
