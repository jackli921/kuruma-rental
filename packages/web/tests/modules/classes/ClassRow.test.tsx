import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SIZE_LABELS: Record<string, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'stats.cars': '{count} cars',
        'stats.activeBookings': '{count} active',
        'stats.seats': '{count} seats',
        'stats.luggage': '{count} bags',
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

import { ClassRow } from '@/modules/classes/components/ClassRow'

const baseClass = {
  id: 'c1',
  operatorId: 'op_a',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM' as const,
  transmission: 'AUTO' as const,
  fuelType: null,
  acrissCode: null,
  sortOrder: 0,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const stats = { carsCount: 3, activeBookingsCount: 1 }

describe('ClassRow', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the luggage capacity and default size (#457)', () => {
    render(<ClassRow vehicleClass={baseClass} stats={stats} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('2 bags')).toBeInTheDocument()
    expect(screen.getByText(/Medium/)).toBeInTheDocument()
  })
})
