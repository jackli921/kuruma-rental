import { VehicleForm } from '@/vite/operator-fleet/VehicleForm'
import type { OperatorFleetVehicle, VehicleClassOption } from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Mock the data layer so submits don't hit the network and we can assert the
// exact parsed payload each mutation receives.
vi.mock('@/vite/operator-fleet/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-fleet/api')>()
  return {
    ...actual,
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
  }
})

import { FLEET_QUERY_KEY, createVehicle, updateVehicle } from '@/vite/operator-fleet/api'

const en = enMessages.business.vehicles.form

const classOptions: VehicleClassOption[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Compact' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'SUV' },
]

function existingVehicle(overrides: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: 'veh_1',
    operatorId: 'op_1',
    classId: '11111111-1111-4111-8111-111111111111',
    pickupLocationId: null,
    name: 'Toyota Aqua',
    description: 'Reliable hybrid',
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    licensePlate: 'なにわ 300 あ 12-34',
    status: 'AVAILABLE',
    minRentalHours: 4,
    maxRentalHours: 72,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Aqua',
    year: 2022,
    color: 'White',
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

interface RenderOptions {
  vehicle?: OperatorFleetVehicle | null
  onSaved?: () => void
  onCancel?: () => void
}

function renderForm({ vehicle = null, onSaved = vi.fn(), onCancel = vi.fn() }: RenderOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <VehicleForm
          vehicle={vehicle}
          classOptions={classOptions}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { ...utils, onSaved, onCancel, invalidateSpy }
}

const mockedCreate = vi.mocked(createVehicle)
const mockedUpdate = vi.mocked(updateVehicle)

beforeEach(() => {
  mockedCreate.mockReset()
  mockedUpdate.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('VehicleForm', () => {
  it('create mode: submits the parsed input to createVehicle', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Honda Fit',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 7500,
        photos: [],
      }),
    )
  })

  it('edit mode: pre-fills from the vehicle and submits updateVehicle(id, ...)', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValue(existingVehicle())
    renderForm({ vehicle: existingVehicle() })

    // Pre-filled from the existing vehicle.
    const nameInput = screen.getByLabelText(en.name) as HTMLInputElement
    expect(nameInput.value).toBe('Toyota Aqua')
    expect((screen.getByLabelText(en.seats) as HTMLInputElement).value).toBe('5')

    await user.clear(nameInput)
    await user.type(nameInput, 'Toyota Aqua G')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith(
      'veh_1',
      expect.objectContaining({ name: 'Toyota Aqua G', dailyRateJpy: 6800 }),
    )
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('blocks submit and shows a field error when required input is invalid', async () => {
    const user = userEvent.setup()
    // Create mode: name is blank and no rate is set -> two validation failures.
    renderForm()

    await user.click(screen.getByRole('button', { name: en.save }))

    // Name-required error surfaces; the create mutation never fires.
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('fires onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: en.cancel }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('invalidates the fleet query and fires onSaved after a successful create', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    const { onSaved, invalidateSpy } = renderForm()

    await user.type(screen.getByLabelText(en.name), 'Mazda Demio')
    await user.type(screen.getByLabelText(en.hourlyRate), '1200')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: FLEET_QUERY_KEY })
  })
})
