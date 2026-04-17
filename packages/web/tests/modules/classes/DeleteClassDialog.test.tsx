import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars && 'count' in vars) return `${key}:${vars.count}`
    if (vars && 'name' in vars) return `${key}:${vars.name}`
    return key
  },
}))

const archiveClassAction = vi.fn()
vi.mock('@/modules/classes/actions', () => ({
  archiveClassAction: (...args: unknown[]) => archiveClassAction(...args),
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
  return {
    client,
    ...render(
      <DeleteClassDialog vehicleClass={mockClass} stats={stats} onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    ),
  }
}

describe('DeleteClassDialog', () => {
  afterEach(() => {
    cleanup()
    archiveClassAction.mockReset()
  })

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

  // HIGH 1 regression: two synchronous clicks within one frame both see
  // isPending=false because React state updates haven't flushed. Without a
  // synchronous guard, the archive action fires twice.
  it('fires archiveClassAction only once when the delete button is double-clicked rapidly', async () => {
    // Pending promise so isPending stays true after the first click settles.
    archiveClassAction.mockReturnValue(new Promise(() => {}))
    renderDialog({ carsCount: 3, activeBookingsCount: 0 })
    const button = screen.getByRole('button', { name: 'deleteConfirm' })

    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      // Flush any microtasks queued by useMutation without waiting for
      // isPending state updates to propagate back to the click handler.
      await Promise.resolve()
    })

    expect(archiveClassAction).toHaveBeenCalledTimes(1)
    expect(archiveClassAction).toHaveBeenCalledWith('c1')
  })

  // HIGH 2 regression: when the dialog opens (vehicleClass goes non-null) we
  // must refetch fleet-overview so the "safe to archive" decision reflects
  // fresh data, not a cached snapshot that may predate a just-confirmed
  // booking.
  it('refetches fleet-overview queries when the dialog opens', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const refetchSpy = vi.spyOn(client, 'refetchQueries')

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DeleteClassDialog vehicleClass={null} stats={null} onOpenChange={() => {}} />
      </QueryClientProvider>,
    )

    // Closed dialog should not trigger a refetch.
    expect(refetchSpy).not.toHaveBeenCalled()

    rerender(
      <QueryClientProvider client={client}>
        <DeleteClassDialog
          vehicleClass={mockClass}
          stats={{ carsCount: 3, activeBookingsCount: 0 }}
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    )

    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['vehicles', 'fleet-overview'] })
  })
})
