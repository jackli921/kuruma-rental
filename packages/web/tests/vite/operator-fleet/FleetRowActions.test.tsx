import { FleetRowActions } from '@/vite/operator-fleet/FleetRowActions'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Mock the api module: the component is controlled, so the test asserts which
// write was invoked with which args, not the network. base-ui's Menu portals
// its items only when open; passthrough-mock the dropdown so the actions render
// inline and the test can click them without driving the portal/positioner.
// The component reads the CSRF token from the session and echoes it on every
// cookie write (#1304); mock a fixed token so the assertions can pin it.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

const updateVehicleStatus = vi.fn()
const retireVehicle = vi.fn()
vi.mock('@/vite/operator-fleet/api', async () => {
  const actual = await vi.importActual<typeof import('@/vite/operator-fleet/api')>(
    '@/vite/operator-fleet/api',
  )
  return {
    ...actual,
    updateVehicleStatus: (...args: unknown[]) => updateVehicleStatus(...args),
    retireVehicle: (...args: unknown[]) => retireVehicle(...args),
  }
})
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render }: { render?: ReactNode; children?: ReactNode }) => <>{render}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    render: r,
    children,
    onClick,
  }: {
    render?: ReactNode
    children?: ReactNode
    onClick?: () => void
  }) =>
    r ?? (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  DropdownMenuSeparator: () => <hr />,
}))

const en = enMessages.business.vehicles

function vehicle(overrides: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: 'v1',
    operatorId: 'op_1',
    classId: null,
    pickupLocationId: null,
    name: 'Toyota Aqua',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'なにわ 300 あ 12-34',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Aqua',
    year: 2022,
    color: null,
    dailyRateJpy: 6800,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-01-01',
    insuranceExpiryDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...overrides,
  }
}

function renderActions(
  v: OperatorFleetVehicle,
  onEdit: () => void = vi.fn(),
  pickedOperatorId?: string,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <FleetRowActions vehicle={v} onEdit={onEdit} pickedOperatorId={pickedOperatorId} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { client, invalidateSpy }
}

describe('FleetRowActions', () => {
  beforeEach(() => {
    updateVehicleStatus.mockReset().mockResolvedValue(vehicle())
    retireVehicle.mockReset().mockResolvedValue(vehicle({ status: 'RETIRED' }))
  })
  afterEach(() => cleanup())

  it('calls onEdit when the Edit action is chosen', () => {
    const onEdit = vi.fn()
    renderActions(vehicle(), onEdit)

    fireEvent.click(screen.getByText(en.editVehicle))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('requires a reason and calls updateVehicleStatus(id, MAINTENANCE, reason) when going to maintenance', async () => {
    renderActions(vehicle({ id: 'v9', status: 'AVAILABLE' }))

    fireEvent.click(screen.getByText(en.actions.setMaintenance))

    // Dialog opens; submit is blocked until a reason is entered.
    const submit = await screen.findByRole('button', { name: en.maintenance.submit })
    expect(submit).toBeDisabled()
    expect(updateVehicleStatus).not.toHaveBeenCalled()

    const reason = screen.getByPlaceholderText(en.maintenance.reasonPlaceholder)
    fireEvent.change(reason, { target: { value: 'Brake inspection' } })
    fireEvent.click(screen.getByRole('button', { name: en.maintenance.submit }))

    await waitFor(() => {
      expect(updateVehicleStatus).toHaveBeenCalledWith(
        'v9',
        'MAINTENANCE',
        'test-csrf',
        'Brake inspection',
        undefined,
      )
    })
  })

  it('calls updateVehicleStatus(id, AVAILABLE) with no reason when leaving maintenance', async () => {
    renderActions(vehicle({ id: 'v7', status: 'MAINTENANCE' }))

    fireEvent.click(screen.getByText(en.actions.setAvailable))

    await waitFor(() => {
      expect(updateVehicleStatus).toHaveBeenCalledWith(
        'v7',
        'AVAILABLE',
        'test-csrf',
        undefined,
        undefined,
      )
    })
    expect(retireVehicle).not.toHaveBeenCalled()
  })

  it('calls retireVehicle(id) only after the retire confirmation is accepted', async () => {
    renderActions(vehicle({ id: 'v3', name: 'Honda Fit' }))

    fireEvent.click(screen.getByText(en.retireVehicle))

    // Confirm dialog: nothing happens until the destructive confirm is clicked.
    const confirm = await screen.findByRole('button', { name: en.retireVehicle })
    expect(retireVehicle).not.toHaveBeenCalled()

    fireEvent.click(confirm)

    await waitFor(() => {
      expect(retireVehicle).toHaveBeenCalledWith('v3', 'test-csrf', undefined)
    })
    expect(retireVehicle).toHaveBeenCalledTimes(1)
  })

  it('binds writes to the picked operator (#1260): forwards pickedOperatorId to status + retire', async () => {
    renderActions(vehicle({ id: 'v3', status: 'MAINTENANCE' }), vi.fn(), 'op_42')

    fireEvent.click(screen.getByText(en.actions.setAvailable))
    await waitFor(() => {
      expect(updateVehicleStatus).toHaveBeenCalledWith(
        'v3',
        'AVAILABLE',
        'test-csrf',
        undefined,
        'op_42',
      )
    })

    fireEvent.click(screen.getByText(en.retireVehicle))
    fireEvent.click(await screen.findByRole('button', { name: en.retireVehicle }))
    await waitFor(() => {
      expect(retireVehicle).toHaveBeenCalledWith('v3', 'test-csrf', 'op_42')
    })
  })

  it('invalidates the fleet query after a successful status change', async () => {
    const { invalidateSpy } = renderActions(vehicle({ id: 'v5', status: 'MAINTENANCE' }))

    fireEvent.click(screen.getByText(en.actions.setAvailable))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['operator-fleet'] })
    })
  })

  it('surfaces an inline error when a status change fails', async () => {
    updateVehicleStatus.mockRejectedValueOnce(new Error('network boom'))
    renderActions(vehicle({ id: 'v6', status: 'MAINTENANCE' }))

    fireEvent.click(screen.getByText(en.actions.setAvailable))

    await waitFor(() => {
      expect(screen.getByText(en.statusToggle.error)).toBeInTheDocument()
    })
  })

  it('shows the retire-specific error (not the status copy) when retire fails', async () => {
    retireVehicle.mockRejectedValueOnce(new Error('network boom'))
    renderActions(vehicle({ id: 'v8' }))

    fireEvent.click(screen.getByText(en.retireVehicle))
    fireEvent.click(await screen.findByRole('button', { name: en.retireVehicle }))

    await waitFor(() => {
      expect(screen.getByText(en.retireError)).toBeInTheDocument()
    })
    // The wrong "could not update status" copy must NOT be used for a retire failure.
    expect(screen.queryByText(en.statusToggle.error)).not.toBeInTheDocument()
  })

  it('shows the status error inside the maintenance dialog when the reason submit fails', async () => {
    updateVehicleStatus.mockRejectedValueOnce(new Error('network boom'))
    renderActions(vehicle({ id: 'v9', status: 'AVAILABLE' }))

    fireEvent.click(screen.getByText(en.actions.setMaintenance))
    const reason = screen.getByPlaceholderText(en.maintenance.reasonPlaceholder)
    fireEvent.change(reason, { target: { value: 'Brake inspection' } })
    fireEvent.click(screen.getByRole('button', { name: en.maintenance.submit }))

    // The maintenance dialog stays open on failure and surfaces the error in-context;
    // the reason field the operator submitted is still on screen.
    await waitFor(() => {
      expect(screen.getByText(en.statusToggle.error)).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(en.maintenance.reasonPlaceholder)).toBeInTheDocument()
  })
})
