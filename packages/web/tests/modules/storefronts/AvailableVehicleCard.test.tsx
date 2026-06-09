import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SIZE_LABELS: Record<string, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        seats: '{count} seats',
        luggage: '{count} bags',
        auto: 'Automatic',
        manual: 'Manual',
        fromDaily: 'From ¥{price} / day',
        fromHourly: 'From ¥{price} / hour',
        noPrice: 'Price on request',
        'detail.book': 'Book',
      }
      const template =
        namespace === 'luggageSize' ? (SIZE_LABELS[key] ?? key) : (messages[key] ?? key)
      if (!values) return template
      return Object.entries(values).reduce<string>(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template,
      )
    }
    t.has = () => false
    return t
  },
}))

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { AvailableVehicleCard } from '@/modules/storefronts/components/AvailableVehicleCard'

const baseVehicle = {
  id: 'v1',
  name: 'Toyota Alphard',
  photos: ['https://example.com/a.jpg'],
  seats: 7,
  transmission: 'AUTO' as const,
  dailyRateJpy: 15000,
  hourlyRateJpy: null,
  luggageCapacity: 4,
  luggageSize: 'LARGE' as const,
}

const props = { locationId: 'loc1', from: '2026-07-01T09:00:00Z', to: '2026-07-03T09:00:00Z' }

describe('AvailableVehicleCard luggage (#457)', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the resolved luggage count and size when both are present', () => {
    render(<AvailableVehicleCard vehicle={baseVehicle} {...props} />)
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  it('shows the count alone when the resolved size is null', () => {
    render(<AvailableVehicleCard vehicle={{ ...baseVehicle, luggageSize: null }} {...props} />)
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.queryByText(/Large/)).toBeNull()
  })

  it('renders no luggage line when capacity is unknown (classless, no override)', () => {
    render(
      <AvailableVehicleCard
        vehicle={{ ...baseVehicle, luggageCapacity: null, luggageSize: null }}
        {...props}
      />,
    )
    expect(screen.queryByText(/bags/)).toBeNull()
  })
})
