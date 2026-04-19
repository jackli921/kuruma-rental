'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { createClassBooking } from '@/lib/bookings'
import { fetchClassAvailability } from '@/modules/classes'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

interface VehicleClassSummary {
  id: string
  slug: string
  name: string
}

interface ClassBookingFormProps {
  vehicleClass: VehicleClassSummary
}

type AvailabilityState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ready'; totalCars: number; availableCars: number }
  | { status: 'error' }

// Renter-facing booking form. The middleware already redirects unauthenticated
// users away from /bookings/*, so this component assumes an authed renter and
// focuses on date selection + availability gating.
export function ClassBookingForm({ vehicleClass }: ClassBookingFormProps) {
  const t = useTranslations('bookings.new')
  const router = useRouter()
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [availability, setAvailability] = useState<AvailabilityState>({ status: 'idle' })
  const [submitState, setSubmitState] = useState<{ isPending: boolean; error: string | null }>({
    isPending: false,
    error: null,
  })

  const hasValidRange = startAt !== '' && endAt !== '' && new Date(endAt) > new Date(startAt)

  // Debounced availability check: fire when the user has a valid pair of
  // dates. The endpoint is cheap and idempotent, so there's no need for
  // anything fancier than a short debounce and cancel flag. The effect
  // stores only discriminated status values — translation happens in the
  // JSX below so the effect doesn't depend on the unstable `t` ref.
  useEffect(() => {
    if (!hasValidRange) {
      setAvailability({ status: 'idle' })
      return
    }
    let cancelled = false
    setAvailability({ status: 'checking' })
    const from = new Date(startAt)
    const to = new Date(endAt)
    const timer = setTimeout(async () => {
      const result = await fetchClassAvailability(vehicleClass.slug, from, to)
      if (cancelled) return
      if (!result) {
        setAvailability({ status: 'error' })
        return
      }
      setAvailability({
        status: 'ready',
        totalCars: result.totalCars,
        availableCars: result.availableCars,
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hasValidRange, startAt, endAt, vehicleClass.slug])

  const canSubmit =
    hasValidRange && availability.status === 'ready' && availability.availableCars > 0

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitState({ isPending: true, error: null })
    const result = await createClassBooking({
      classId: vehicleClass.id,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
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

      {availability.status === 'idle' && (
        <p className="text-sm text-muted-foreground">{t('selectDates')}</p>
      )}

      {availability.status === 'checking' && (
        <p className="text-sm text-muted-foreground">{t('checkingAvailability')}</p>
      )}

      {availability.status === 'ready' && availability.availableCars > 0 && (
        <output className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            {t('available')} ·{' '}
            {t('availableCount', {
              count: availability.availableCars,
              total: availability.totalCars,
            })}
          </span>
        </output>
      )}

      {availability.status === 'ready' && availability.availableCars === 0 && (
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <XCircle className="size-4 shrink-0" />
          {t('notAvailable')}
        </div>
      )}

      {availability.status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <XCircle className="size-4 shrink-0" />
          {t('availabilityError')}
        </div>
      )}

      {submitState.error && (
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <XCircle className="size-4 shrink-0" />
          {submitState.error}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={!canSubmit || submitState.isPending}>
        {submitState.isPending ? t('submitting') : t('confirmBooking')}
      </Button>
    </form>
  )
}
