import { VehicleForm } from '@/vite/operator-fleet/VehicleForm'
import type {
  OperatorFleetVehicle,
  PickupLocationOption,
  VehicleClassOption,
} from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The form reads the CSRF token from the session and echoes it on the create/
// update write (#1304); mock a fixed token so the payload assertions can pin it.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

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

const OSAKA_LOCATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const KYOTO_LOCATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const locationOptions: PickupLocationOption[] = [
  { id: OSAKA_LOCATION_ID, name: 'Osaka Namba', status: 'ACTIVE' },
  { id: KYOTO_LOCATION_ID, name: 'Kyoto Station', status: 'ACTIVE' },
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
    insuranceExpiryDate: '2099-01-01',
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
  locations?: readonly PickupLocationOption[]
  onSaved?: () => void
  onCancel?: () => void
  pickedOperatorId?: string
}

function renderForm({
  vehicle = null,
  locations = locationOptions,
  onSaved = vi.fn(),
  onCancel = vi.fn(),
  pickedOperatorId,
}: RenderOptions = {}) {
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
          locationOptions={locations}
          onSaved={onSaved}
          onCancel={onCancel}
          pickedOperatorId={pickedOperatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { ...utils, onSaved, onCancel, invalidateSpy }
}

// §5.0 / #916: create now requires valid, future-dated shaken + insurance docs.
// Fill both so happy-path submit tests exercise the mutation instead of tripping
// the compliance gate. Far-future dates keep the tests clock-independent.
async function fillRequiredDocs(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en.shakenExpiryDate), '2099-01-01')
  await user.type(screen.getByLabelText(en.insuranceExpiryDate), '2099-01-01')
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
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Honda Fit',
        seats: 5,
        transmission: 'AUTO',
        dailyRateJpy: 7500,
        photos: [],
        shakenExpiryDate: '2099-01-01',
        insuranceExpiryDate: '2099-01-01',
      }),
      'test-csrf',
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
      'test-csrf',
    )
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('edit mode: saves a legacy vehicle with null shaken/insurance docs (#986)', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValue(existingVehicle())
    // A legacy/lapsed car has null docs. Edit must tolerate them: the create-only
    // required-docs rule (#916) must not leak into the edit resolver, or the
    // operator can't change *any* field until they back-fill both documents.
    renderForm({ vehicle: existingVehicle({ shakenExpiryDate: null, insuranceExpiryDate: null }) })

    const nameInput = screen.getByLabelText(en.name) as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'Toyota Aqua Legacy')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith(
      'veh_1',
      expect.objectContaining({ name: 'Toyota Aqua Legacy' }),
      'test-csrf',
    )
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

  it('create mode: blocks submit when shaken docs are expired (§5.0)', async () => {
    const user = userEvent.setup()
    // Everything else valid; only the shaken cert is back-dated. The create
    // schema's not-past refine must reject it before the mutation fires.
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await user.type(screen.getByLabelText(en.shakenExpiryDate), '2000-01-01')
    await user.type(screen.getByLabelText(en.insuranceExpiryDate), '2099-01-01')
    await user.click(screen.getByRole('button', { name: en.save }))

    expect(await screen.findByText('Shaken expiry must not be in the past')).toBeInTheDocument()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('fires onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderForm()

    await user.click(screen.getByRole('button', { name: en.cancel }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('create mode: submits the chosen luggage override (size + capacity)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await user.selectOptions(screen.getByLabelText(en.luggageSize), 'LARGE')
    await user.type(screen.getByLabelText(en.luggageCapacity), '3')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ luggageSize: 'LARGE', luggageCapacity: 3 }),
      'test-csrf',
    )
  })

  it('create mode: a blank luggage override submits null (inherit from class)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ luggageSize: null, luggageCapacity: null }),
      'test-csrf',
    )
  })

  it('edit mode: pre-fills the luggage override from the vehicle', () => {
    renderForm({ vehicle: existingVehicle({ luggageSize: 'LARGE', luggageCapacity: 4 }) })

    expect((screen.getByLabelText(en.luggageSize) as HTMLSelectElement).value).toBe('LARGE')
    expect((screen.getByLabelText(en.luggageCapacity) as HTMLInputElement).value).toBe('4')
  })

  it('edit mode: preserves a since-archived class that is missing from the active options', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValue(existingVehicle())
    // The vehicle's class was archived, so it is absent from the active
    // `classOptions` the parent fetches (/manage without includeArchived).
    const archivedClassId = '99999999-9999-4999-8999-999999999999'
    renderForm({ vehicle: existingVehicle({ classId: archivedClassId }) })

    // The picker keeps the assigned class selected via a preserved option
    // instead of silently falling back to "Unassigned".
    const classSelect = screen.getByLabelText(en.class) as HTMLSelectElement
    expect(classSelect.value).toBe(archivedClassId)

    // Editing an unrelated field and saving must NOT clear the classId.
    const nameInput = screen.getByLabelText(en.name)
    await user.clear(nameInput)
    await user.type(nameInput, 'Toyota Aqua G')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith(
      'veh_1',
      expect.objectContaining({ classId: archivedClassId }),
      'test-csrf',
    )
  })

  it('invalidates the fleet query and fires onSaved after a successful create', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    const { onSaved, invalidateSpy } = renderForm()

    await user.type(screen.getByLabelText(en.name), 'Mazda Demio')
    await user.type(screen.getByLabelText(en.hourlyRate), '1200')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: FLEET_QUERY_KEY })
  })

  it('create mode: submits the chosen pickup location (#1262)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await user.selectOptions(screen.getByLabelText(en.pickupLocation), OSAKA_LOCATION_ID)
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ pickupLocationId: OSAKA_LOCATION_ID }),
      'test-csrf',
    )
  })

  it('create mode: an unselected pickup location submits null (#1262)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm()

    await user.type(screen.getByLabelText(en.name), 'Honda Fit')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ pickupLocationId: null }),
      'test-csrf',
    )
  })

  it('offers only ACTIVE locations as selectable options (#1262)', () => {
    renderForm({
      locations: [
        ...locationOptions,
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Kobe (retired)', status: 'ARCHIVED' },
      ],
    })

    const select = screen.getByLabelText(en.pickupLocation) as HTMLSelectElement
    const optionNames = Array.from(select.options).map((o) => o.textContent)
    expect(optionNames).toEqual([en.pickupLocationNone, 'Osaka Namba', 'Kyoto Station'])
    expect(optionNames).not.toContain('Kobe (retired)')
  })

  it('edit mode: pre-fills the pickup location from the vehicle (#1262)', () => {
    renderForm({ vehicle: existingVehicle({ pickupLocationId: KYOTO_LOCATION_ID }) })

    expect((screen.getByLabelText(en.pickupLocation) as HTMLSelectElement).value).toBe(
      KYOTO_LOCATION_ID,
    )
  })

  it('edit mode: preserves a since-archived pickup location missing from active options (#1262)', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValue(existingVehicle())
    const archivedLocationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    // The assigned location was archived: it is filtered out of the selectable
    // ACTIVE list but still arrives (includeArchived=true) so the form can label
    // and preserve it rather than silently clearing the link on save.
    renderForm({
      vehicle: existingVehicle({ pickupLocationId: archivedLocationId }),
      locations: [
        ...locationOptions,
        { id: archivedLocationId, name: 'Sakai Depot', status: 'ARCHIVED' },
      ],
    })

    const select = screen.getByLabelText(en.pickupLocation) as HTMLSelectElement
    expect(select.value).toBe(archivedLocationId)
    // The preserved option shows the real archived name, not a generic label.
    expect(screen.getByRole('option', { name: 'Sakai Depot' })).toBeInTheDocument()

    const nameInput = screen.getByLabelText(en.name)
    await user.clear(nameInput)
    await user.type(nameInput, 'Toyota Aqua G')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith(
      'veh_1',
      expect.objectContaining({ pickupLocationId: archivedLocationId }),
      'test-csrf',
    )
  })

  it('edit mode: labels a preserved pickup location generically when it is absent from the fetched list (#1262)', async () => {
    const user = userEvent.setup()
    mockedUpdate.mockResolvedValue(existingVehicle())
    // The assigned location is missing from the returned options entirely (a
    // partial fetch or a stale link), so there is no name to show. The form
    // still preserves the id and labels it with the generic "current" fallback
    // rather than silently clearing the link on save.
    const missingLocationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    renderForm({ vehicle: existingVehicle({ pickupLocationId: missingLocationId }) })

    const select = screen.getByLabelText(en.pickupLocation) as HTMLSelectElement
    expect(select.value).toBe(missingLocationId)
    expect(screen.getByRole('option', { name: en.pickupLocationCurrent })).toBeInTheDocument()

    const nameInput = screen.getByLabelText(en.name)
    await user.clear(nameInput)
    await user.type(nameInput, 'Toyota Aqua G')
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1))
    expect(mockedUpdate).toHaveBeenCalledWith(
      'veh_1',
      expect.objectContaining({ pickupLocationId: missingLocationId }),
      'test-csrf',
    )
  })

  it('shows a hint instead of the picker when the operator has no locations (#1262)', () => {
    // Zero locations is the exact state that leaves a UI-created car invisible to
    // renters; surface a hint rather than silently hiding the field.
    renderForm({ locations: [] })

    expect(screen.queryByLabelText(en.pickupLocation)).not.toBeInTheDocument()
    expect(screen.getByText(en.pickupLocationEmptyHint)).toBeInTheDocument()
  })

  it('injects the picked operatorId into the create body (#1264)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm({ vehicle: null, pickedOperatorId: 'op_9' })

    await user.type(screen.getByLabelText(en.name), 'New Car')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled())
    expect(vi.mocked(createVehicle).mock.calls[0]![0]).toMatchObject({ operatorId: 'op_9' })
  })

  it('omits operatorId from the create body when no operator is picked (#1264)', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue(existingVehicle())
    renderForm({ vehicle: null })

    await user.type(screen.getByLabelText(en.name), 'New Car')
    await user.type(screen.getByLabelText(en.dailyRate), '7500')
    await fillRequiredDocs(user)
    await user.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled())
    expect(vi.mocked(createVehicle).mock.calls[0]![0]).not.toHaveProperty('operatorId')
  })
})
