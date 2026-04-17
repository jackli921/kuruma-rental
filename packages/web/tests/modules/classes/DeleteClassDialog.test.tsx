import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars && 'count' in vars) return `${key}:${vars.count}`
    if (vars && 'name' in vars) return `${key}:${vars.name}`
    return key
  },
}))

vi.mock('@/modules/classes/actions', () => ({
  archiveClassAction: vi.fn(),
}))

import type { VehicleClassData } from '@/modules/classes/api'
import { DeleteClassDialog } from '@/modules/classes/components/DeleteClassDialog'
import type { ClassStats } from '@/modules/classes/stats'

const mockClass: VehicleClassData = {
  id: 'c1',
  name: 'Compact',
  slug: 'compact',
  description: null,
  photos: [],
  seats: 5,
  luggageCapacity: 2,
  transmission: 'AUTO',
  fuelType: null,
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function renderDialog(stats: ClassStats | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <DeleteClassDialog vehicleClass={mockClass} stats={stats} onOpenChange={() => {}} />,
    { wrapper: Wrapper },
  )
}

describe('DeleteClassDialog', () => {
  afterEach(() => cleanup())

  it('disables delete button while stats are loading (null)', () => {
    renderDialog(null)
    const button = screen.getByRole('button', { name: 'deleteConfirm' })
    expect(button).toBeDisabled()
  })

  it('disables delete button when class has active bookings', () => {
    renderDialog({ carsCount: 2, activeBookingsCount: 1 })
    const button = screen.getByRole('button', { name: 'deleteConfirm' })
    expect(button).toBeDisabled()
    // And the warning is visible.
    expect(screen.getByText(/deleteBlockedActiveBookings:1/)).toBeInTheDocument()
  })

  it('enables delete button when no active bookings', () => {
    renderDialog({ carsCount: 3, activeBookingsCount: 0 })
    const button = screen.getByRole('button', { name: 'deleteConfirm' })
    expect(button).not.toBeDisabled()
  })

  it('does not show the blocked warning when there are zero active bookings', () => {
    renderDialog({ carsCount: 3, activeBookingsCount: 0 })
    expect(screen.queryByText(/deleteBlockedActiveBookings/)).not.toBeInTheDocument()
  })
})
