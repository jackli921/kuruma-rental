import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SIZE_LABELS: Record<string, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }

vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) =>
    Promise.resolve((key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        seats: '{count} seats',
        luggage: '{count} bags',
        auto: 'Automatic',
        manual: 'Manual',
        perDay: '/ day',
        pickupDate: 'Pickup',
        returnDate: 'Return',
      }
      const template =
        namespace === 'luggageSize' ? (SIZE_LABELS[key] ?? key) : (messages[key] ?? key)
      if (!values) return template
      return Object.entries(values).reduce<string>(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template,
      )
    }),
}))

import { BookingVehicleSummary } from '@/app/[locale]/bookings/new/BookingVehicleSummary'

const baseVehicle = {
  id: 'v1',
  name: 'Toyota Alphard',
  classLabel: 'Minivan',
  photos: [],
  seats: 7,
  transmission: 'AUTO' as const,
  dailyRateJpy: 15000,
  hourlyRateJpy: null,
  luggageCapacity: 4,
  luggageSize: 'LARGE' as const,
}
const storefront = {
  operatorName: 'Best Car Rental',
  name: 'Osaka Namba',
  address: '1-1 Namba',
}
const range = { from: new Date('2026-07-01T09:00:00Z'), to: new Date('2026-07-03T09:00:00Z') }

async function renderSummary(vehicle: typeof baseVehicle) {
  // Server component — await it to a React element before rendering.
  render(await BookingVehicleSummary({ vehicle, storefront, ...range }))
}

describe('BookingVehicleSummary luggage (#457)', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the resolved luggage count and size', async () => {
    await renderSummary(baseVehicle)
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  it('shows the count alone when the resolved size is null', async () => {
    await renderSummary({ ...baseVehicle, luggageSize: null })
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.queryByText(/Large/)).toBeNull()
  })

  it('renders no luggage line when capacity is unknown', async () => {
    await renderSummary({ ...baseVehicle, luggageCapacity: null, luggageSize: null })
    expect(screen.queryByText(/bags/)).toBeNull()
  })
})
