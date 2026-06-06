'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { createBooking } from '@/lib/bookings'
import { formatJpy } from '@/lib/format'
import type { StorefrontInsuranceOptionData } from '@/modules/storefronts'
import { XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface VehicleBookingFormProps {
  vehicleId: string
  /** The storefront location — booking pickup AND dropoff (single-location rental). */
  pickupLocationId: string
  /** Dates already chosen in search, as ISO strings for the API. */
  startAtIso: string
  endAtIso: string
  insuranceOptions: StorefrontInsuranceOptionData[]
}

// '' encodes "decline coverage" — sent as insuranceOptionId: null.
const DECLINE = ''

// Slice 6 (#392) renter booking form. The vehicle, location, and dates were
// fixed in the storefront flow (the car is already known available), so the only
// choice here is insurance. Submit derives everything else server-side.
export function VehicleBookingForm({
  vehicleId,
  pickupLocationId,
  startAtIso,
  endAtIso,
  insuranceOptions,
}: VehicleBookingFormProps) {
  const t = useTranslations('bookings.new')
  const router = useRouter()
  const [insuranceOptionId, setInsuranceOptionId] = useState<string>(DECLINE)
  const [submitState, setSubmitState] = useState<{ isPending: boolean; error: string | null }>({
    isPending: false,
    error: null,
  })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setSubmitState({ isPending: true, error: null })
    const result = await createBooking({
      requestedVehicleId: vehicleId,
      pickupLocationId,
      dropoffLocationId: pickupLocationId,
      insuranceOptionId: insuranceOptionId || null,
      startAt: startAtIso,
      endAt: endAtIso,
    })
    if (result.success) {
      router.push(`/bookings/confirmation?bookingId=${result.bookingId}`)
      return
    }
    setSubmitState({ isPending: false, error: result.error })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="insuranceOptionId">{t('insurance')}</Label>
        {insuranceOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noInsurance')}</p>
        ) : (
          <select
            id="insuranceOptionId"
            name="insuranceOptionId"
            value={insuranceOptionId}
            onChange={(e) => setInsuranceOptionId(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          >
            <option value={DECLINE}>{t('declineInsurance')}</option>
            {insuranceOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {formatJpy(o.dailyPriceJpy)}
                {t('perDay')}
              </option>
            ))}
          </select>
        )}
        <p className="text-sm text-muted-foreground">{t('insuranceHint')}</p>
      </div>

      {submitState.error && (
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <XCircle className="size-4 shrink-0" />
          {submitState.error}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitState.isPending}>
        {submitState.isPending ? t('submitting') : t('confirmBooking')}
      </Button>
    </form>
  )
}
