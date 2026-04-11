// Issue #51: inline status toggle on fleet list rows. Tests describe
// observable behaviour (what the user sees and what the API gets called
// with), not internal React Query plumbing.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'status.AVAILABLE': 'Available',
      'status.MAINTENANCE': 'Maintenance',
      'status.RETIRED': 'Retired',
      'statusToggle.restore': 'Restore',
      'statusToggle.error': 'Could not update status. Please try again.',
      'statusToggle.ariaLabel': 'Change status',
    }
    return messages[key] ?? key
  },
}))

const updateVehicleStatusMock = vi.fn()
vi.mock('@/lib/vehicle-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/vehicle-api')>('@/lib/vehicle-api')
  return {
    ...actual,
    updateVehicleStatus: (...args: unknown[]) => updateVehicleStatusMock(...args),
  }
})

import { VehicleStatusToggle } from '@/components/vehicles/VehicleStatusToggle'
import type { VehicleData } from '@/lib/vehicle-api'

function makeVehicle(overrides: Partial<VehicleData> = {}): VehicleData {
  return {
    id: 'v_1',
    name: 'Toyota Corolla',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderWithClient(
  ui: ReactNode,
  seed?: { vehicles?: VehicleData[] },
): { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime must be Infinity (or large) because the test seeds data via
      // setQueryData without a mounted useQuery observer; with the default
      // gc, the onSettled → invalidateQueries path evicts the data before
      // assertions can read it.
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  })
  if (seed?.vehicles) {
    client.setQueryData(['vehicles'], seed.vehicles)
  }
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { client }
}

describe('VehicleStatusToggle', () => {
  beforeEach(() => {
    updateVehicleStatusMock.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders AVAILABLE and MAINTENANCE options with AVAILABLE selected when current status is AVAILABLE', () => {
    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    renderWithClient(<VehicleStatusToggle vehicle={vehicle} />)

    const available = screen.getByRole('button', { name: 'Available' })
    const maintenance = screen.getByRole('button', { name: 'Maintenance' })

    expect(available).toHaveAttribute('aria-pressed', 'true')
    expect(maintenance).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls updateVehicleStatus when the user clicks a non-active option', async () => {
    updateVehicleStatusMock.mockResolvedValueOnce({
      ...makeVehicle(),
      status: 'MAINTENANCE',
    })
    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    renderWithClient(<VehicleStatusToggle vehicle={vehicle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }))

    await waitFor(() => {
      expect(updateVehicleStatusMock).toHaveBeenCalledWith('v_1', 'MAINTENANCE')
    })
  })

  it('does not call updateVehicleStatus when the user clicks the already-active option', () => {
    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    renderWithClient(<VehicleStatusToggle vehicle={vehicle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Available' }))

    expect(updateVehicleStatusMock).not.toHaveBeenCalled()
  })

  it('optimistically patches the vehicles cache before the server responds', async () => {
    // Keep the mutation pending so we can observe the optimistic state.
    let resolveMutation: (v: VehicleData) => void = () => {}
    updateVehicleStatusMock.mockImplementationOnce(
      () =>
        new Promise<VehicleData>((res) => {
          resolveMutation = res
        }),
    )

    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    const { client } = renderWithClient(<VehicleStatusToggle vehicle={vehicle} />, {
      vehicles: [vehicle],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }))

    await waitFor(() => {
      const cached = client.getQueryData<VehicleData[]>(['vehicles'])
      expect(cached?.[0]?.status).toBe('MAINTENANCE')
    })

    // Let the mutation resolve so React Query doesn't complain.
    resolveMutation({ ...vehicle, status: 'MAINTENANCE' })
  })

  it('rolls back the optimistic cache update and shows an error when the mutation fails', async () => {
    updateVehicleStatusMock.mockRejectedValueOnce(new Error('network boom'))

    const vehicle = makeVehicle({ status: 'AVAILABLE' })
    const { client } = renderWithClient(<VehicleStatusToggle vehicle={vehicle} />, {
      vehicles: [vehicle],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }))

    await waitFor(() => {
      expect(screen.getByText('Could not update status. Please try again.')).toBeInTheDocument()
    })

    const cached = client.getQueryData<VehicleData[]>(['vehicles'])
    expect(cached?.[0]?.status).toBe('AVAILABLE')
  })

  it('renders a Restore control when status is RETIRED and flips to AVAILABLE on click', async () => {
    updateVehicleStatusMock.mockResolvedValueOnce({
      ...makeVehicle(),
      status: 'AVAILABLE',
    })
    const vehicle = makeVehicle({ status: 'RETIRED' })
    renderWithClient(<VehicleStatusToggle vehicle={vehicle} />)

    // The AVAILABLE/MAINTENANCE segmented control is not interactable in this
    // mode — the owner flips back via a dedicated Restore button.
    expect(screen.queryByRole('button', { name: 'Available' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Maintenance' })).not.toBeInTheDocument()

    const restore = screen.getByRole('button', { name: 'Restore' })
    fireEvent.click(restore)

    await waitFor(() => {
      expect(updateVehicleStatusMock).toHaveBeenCalledWith('v_1', 'AVAILABLE')
    })
  })
})
