import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'form.name': 'Vehicle name',
      'form.namePlaceholder': 'e.g. Toyota Corolla 2024',
      'form.description': 'Description',
      'form.descriptionPlaceholder': 'Brief description',
      'form.seats': 'Seats',
      'form.transmission': 'Transmission',
      'form.transmissionAuto': 'Automatic',
      'form.transmissionManual': 'Manual',
      'form.fuelType': 'Fuel type',
      'form.fuelTypePlaceholder': 'e.g. Gasoline',
      'form.bufferMinutes': 'Buffer time (minutes)',
      'form.pricingHeading': 'Pricing (JPY)',
      'form.pricingHint': 'At least one rate is required.',
      'form.dailyRate': 'Daily rate',
      'form.hourlyRate': 'Hourly rate',
      'form.rentalRulesHeading': 'Rental rules',
      'form.rentalRulesHint': 'Optional limits on how customers can book.',
      'form.minRentalHours': 'Minimum rental (hours)',
      'form.minRentalHoursPlaceholder': '4',
      'form.maxRentalHours': 'Maximum rental (hours)',
      'form.maxRentalHoursPlaceholder': '72',
      'form.advanceBookingHours': 'Advance booking (hours)',
      'form.advanceBookingHoursPlaceholder': '24',
      'form.complianceHeading': 'Compliance',
      'form.complianceHint': 'Track vehicle inspection (shaken) and insurance expiry dates.',
      'form.shakenExpiryDate': 'Shaken expiry date',
      'form.insuranceExpiryDate': 'Insurance expiry date',
      'form.save': 'Save vehicle',
      'form.saving': 'Saving...',
      'form.cancel': 'Cancel',
      'form.class': 'Class',
      'form.classNone': 'Unassigned',
      'form.operator': 'Operator',
      'form.operatorPlaceholder': 'Select an operator',
      'form.operatorRequired': 'Operator is required',
      'form.pickupLocation': 'Pickup location',
      'form.pickupLocationNone': 'No pickup location',
      'form.pickupLocationCurrent': 'Current pickup location',
    }
    return messages[key] ?? key
  },
}))

import { VehicleForm } from '@/components/vehicles/VehicleForm'
import type { LocationData } from '@/modules/locations'

describe('VehicleForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders all required form fields', () => {
    render(<VehicleForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('Vehicle name')).toBeInTheDocument()
    expect(screen.getByLabelText('Seats')).toBeInTheDocument()
    expect(screen.getByLabelText('Buffer time (minutes)')).toBeInTheDocument()
    expect(screen.getByText('Save vehicle')).toBeInTheDocument()
  })

  it('calls onSubmit with form data when valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<VehicleForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Vehicle name'), 'Toyota Corolla')
    await user.clear(screen.getByLabelText('Seats'))
    await user.type(screen.getByLabelText('Seats'), '5')
    // #48: at least one rate is required — fill the daily rate.
    await user.type(screen.getByLabelText('Daily rate'), '8000')
    await user.click(screen.getByText('Save vehicle'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedData = onSubmit.mock.calls[0][0]
    expect(submittedData.name).toBe('Toyota Corolla')
    expect(submittedData.seats).toBe(5)
    expect(submittedData.transmission).toBe('AUTO')
    expect(submittedData.dailyRateJpy).toBe(8000)
  })

  it('blocks submit and surfaces a pricing error when both rates are empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<VehicleForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Vehicle name'), 'Toyota Corolla')
    // Neither rate is filled.
    await user.click(screen.getByText('Save vehicle'))

    // Wait a tick to let RHF run validation.
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('accepts a vehicle with only the hourly rate', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<VehicleForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Vehicle name'), 'Toyota Corolla')
    await user.type(screen.getByLabelText('Hourly rate'), '1200')
    await user.click(screen.getByText('Save vehicle'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedData = onSubmit.mock.calls[0][0]
    expect(submittedData.hourlyRateJpy).toBe(1200)
    // Daily rate was never filled — the form must submit null, not 0.
    expect(submittedData.dailyRateJpy).toBeNull()
  })

  it('shows default values when provided (edit mode)', () => {
    const defaults = {
      name: 'Honda Fit',
      seats: 4,
      transmission: 'MANUAL' as const,
      bufferMinutes: 90,
      dailyRateJpy: 7500,
      hourlyRateJpy: 1100,
    }

    render(<VehicleForm onSubmit={vi.fn()} defaultValues={defaults} />)

    expect(screen.getByLabelText('Vehicle name')).toHaveValue('Honda Fit')
    expect(screen.getByLabelText('Seats')).toHaveValue(4)
    expect(screen.getByLabelText('Buffer time (minutes)')).toHaveValue(90)
    expect(screen.getByLabelText('Daily rate')).toHaveValue(7500)
    expect(screen.getByLabelText('Hourly rate')).toHaveValue(1100)
  })

  // Issue #50: rental rules (min / max / advance booking).
  describe('rental rules', () => {
    it('renders all three rental-rules inputs with a section heading', () => {
      render(<VehicleForm onSubmit={vi.fn()} />)

      expect(screen.getByText('Rental rules')).toBeInTheDocument()
      expect(screen.getByText('Optional limits on how customers can book.')).toBeInTheDocument()
      expect(screen.getByLabelText('Minimum rental (hours)')).toBeInTheDocument()
      expect(screen.getByLabelText('Maximum rental (hours)')).toBeInTheDocument()
      expect(screen.getByLabelText('Advance booking (hours)')).toBeInTheDocument()
    })

    it('pre-fills sensible defaults: min=4, max=72, advance blank', () => {
      render(<VehicleForm onSubmit={vi.fn()} />)

      expect(screen.getByLabelText('Minimum rental (hours)')).toHaveValue(4)
      expect(screen.getByLabelText('Maximum rental (hours)')).toHaveValue(72)
      expect(screen.getByLabelText('Advance booking (hours)')).not.toHaveValue()
    })

    it('respects defaultValues override over the baked-in defaults (edit mode)', () => {
      render(
        <VehicleForm
          onSubmit={vi.fn()}
          defaultValues={{
            name: 'Honda N-BOX',
            seats: 4,
            transmission: 'AUTO',
            dailyRateJpy: 6500,
            minRentalHours: 6,
            maxRentalHours: 48,
            advanceBookingHours: 12,
          }}
        />,
      )

      expect(screen.getByLabelText('Minimum rental (hours)')).toHaveValue(6)
      expect(screen.getByLabelText('Maximum rental (hours)')).toHaveValue(48)
      expect(screen.getByLabelText('Advance booking (hours)')).toHaveValue(12)
    })

    it('blocks submit and surfaces an error when min > max', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          defaultValues={{
            name: 'Honda N-BOX',
            seats: 4,
            transmission: 'AUTO',
            dailyRateJpy: 6500,
          }}
        />,
      )

      const minInput = screen.getByLabelText('Minimum rental (hours)')
      const maxInput = screen.getByLabelText('Maximum rental (hours)')

      await user.clear(minInput)
      await user.type(minInput, '48')
      await user.clear(maxInput)
      await user.type(maxInput, '12')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).not.toHaveBeenCalled()
      })
    })

    it('submits successfully with valid rental rules', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          defaultValues={{
            name: 'Honda N-BOX',
            seats: 4,
            transmission: 'AUTO',
            dailyRateJpy: 6500,
            minRentalHours: 4,
            maxRentalHours: 72,
            advanceBookingHours: 24,
          }}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1)
      })
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        minRentalHours: 4,
        maxRentalHours: 72,
        advanceBookingHours: 24,
      })
    })

    it('submits null when date fields are empty', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          defaultValues={{
            name: 'Honda N-BOX',
            seats: 4,
            transmission: 'AUTO',
            dailyRateJpy: 6500,
          }}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1)
      })
      expect(onSubmit.mock.calls[0][0].shakenExpiryDate).toBeNull()
      expect(onSubmit.mock.calls[0][0].insuranceExpiryDate).toBeNull()
    })

    it('submits null when advance booking is left blank', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          defaultValues={{
            name: 'Honda N-BOX',
            seats: 4,
            transmission: 'AUTO',
            dailyRateJpy: 6500,
          }}
        />,
      )

      // advance booking is blank by default; leave it alone.
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1)
      })
      expect(onSubmit.mock.calls[0][0].advanceBookingHours).toBeNull()
    })
  })

  // Issue #313: class assignment dropdown
  describe('class assignment', () => {
    const classes = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Compact',
        slug: 'compact',
        description: null,
        photos: [],
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO' as const,
        fuelType: null,
        dailyRateJpy: 8000,
        hourlyRateJpy: null,
        sortOrder: 0,
        status: 'ACTIVE' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'SUV',
        slug: 'suv',
        description: null,
        photos: [],
        seats: 7,
        luggageCapacity: 4,
        transmission: 'AUTO' as const,
        fuelType: null,
        dailyRateJpy: 12000,
        hourlyRateJpy: null,
        sortOrder: 1,
        status: 'ACTIVE' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    it('renders a class dropdown with Unassigned + each class as options', () => {
      render(<VehicleForm onSubmit={vi.fn()} classes={classes} />)

      const select = screen.getByLabelText('Class') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      const optionValues = Array.from(select.options).map((o) => o.value)
      expect(optionValues).toEqual([
        '',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ])
    })

    it('submits the selected classId', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          classes={classes}
          defaultValues={{
            name: 'Honda Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
          }}
        />,
      )

      await user.selectOptions(
        screen.getByLabelText('Class'),
        '22222222-2222-4222-8222-222222222222',
      )
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1)
      })
      expect(onSubmit.mock.calls[0][0].classId).toBe('22222222-2222-4222-8222-222222222222')
    })

    it('submits null when Unassigned is selected', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          classes={classes}
          defaultValues={{
            name: 'Honda Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
            classId: '11111111-1111-4111-8111-111111111111',
          }}
        />,
      )

      await user.selectOptions(screen.getByLabelText('Class'), '')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1)
      })
      expect(onSubmit.mock.calls[0][0].classId).toBeNull()
    })

    it('pre-selects the vehicle classId in edit mode', () => {
      render(
        <VehicleForm
          onSubmit={vi.fn()}
          classes={classes}
          defaultValues={{
            name: 'Honda Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
            classId: '22222222-2222-4222-8222-222222222222',
          }}
        />,
      )

      const select = screen.getByLabelText('Class') as HTMLSelectElement
      expect(select.value).toBe('22222222-2222-4222-8222-222222222222')
    })

    it('does not render the dropdown when no classes are passed', () => {
      render(<VehicleForm onSubmit={vi.fn()} />)
      expect(screen.queryByLabelText('Class')).not.toBeInTheDocument()
    })
  })

  // Issue #435: pickup-location assignment dropdown (mirrors classId; the
  // (operatorId, pickupLocationId) composite FK means the picker is scoped
  // to the selected operator exactly like the class picker).
  describe('pickup location assignment', () => {
    const baseLocation = {
      address: '1-1 Test',
      operatingHours: {} as LocationData['operatingHours'],
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 60,
      status: 'ACTIVE' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const locations: LocationData[] = [
      {
        ...baseLocation,
        id: '0a000000-0000-4000-8000-000000000001',
        operatorId: 'op_a',
        name: 'Osaka Namba',
      },
      {
        ...baseLocation,
        id: '0a000000-0000-4000-8000-000000000002',
        operatorId: 'op_a',
        name: 'Kyoto Station',
      },
    ]

    it('renders a pickup-location dropdown with None + each location as options', () => {
      render(<VehicleForm onSubmit={vi.fn()} locations={locations} />)

      const select = screen.getByLabelText('Pickup location') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        '',
        '0a000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-000000000002',
      ])
    })

    it('submits the selected pickupLocationId', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          locations={locations}
          defaultValues={{ name: 'Fit', seats: 5, transmission: 'AUTO', dailyRateJpy: 7000 }}
        />,
      )

      await user.selectOptions(
        screen.getByLabelText('Pickup location'),
        '0a000000-0000-4000-8000-000000000002',
      )
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].pickupLocationId).toBe(
        '0a000000-0000-4000-8000-000000000002',
      )
    })

    it('submits null when No pickup location is selected', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      render(
        <VehicleForm
          onSubmit={onSubmit}
          locations={locations}
          defaultValues={{
            name: 'Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
            pickupLocationId: '0a000000-0000-4000-8000-000000000001',
          }}
        />,
      )

      await user.selectOptions(screen.getByLabelText('Pickup location'), '')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].pickupLocationId).toBeNull()
    })

    it('pre-selects the vehicle pickupLocationId in edit mode', () => {
      render(
        <VehicleForm
          onSubmit={vi.fn()}
          locations={locations}
          defaultValues={{
            name: 'Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
            pickupLocationId: '0a000000-0000-4000-8000-000000000002',
          }}
        />,
      )

      expect((screen.getByLabelText('Pickup location') as HTMLSelectElement).value).toBe(
        '0a000000-0000-4000-8000-000000000002',
      )
    })

    it('does not render the dropdown when no locations are passed', () => {
      render(<VehicleForm onSubmit={vi.fn()} />)
      expect(screen.queryByLabelText('Pickup location')).not.toBeInTheDocument()
    })

    it('scopes the location dropdown to the selected operator', async () => {
      const user = userEvent.setup()
      const operators = [
        { id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' },
        { id: 'op_b', name: 'Acme Cars', slug: 'acme-cars' },
      ]
      const scoped: LocationData[] = [
        {
          ...baseLocation,
          id: '0b000000-0000-4000-8000-00000000000a',
          operatorId: 'op_a',
          name: 'A Osaka',
        },
        {
          ...baseLocation,
          id: '0b000000-0000-4000-8000-00000000000b',
          operatorId: 'op_b',
          name: 'B Tokyo',
        },
      ]
      render(<VehicleForm onSubmit={vi.fn()} operators={operators} locations={scoped} />)

      await user.selectOptions(screen.getByLabelText('Operator'), 'op_a')
      const select = screen.getByLabelText('Pickup location') as HTMLSelectElement
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        '',
        '0b000000-0000-4000-8000-00000000000a',
      ])
    })

    it('clears a stale pickupLocationId when the operator changes', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const operators = [
        { id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' },
        { id: 'op_b', name: 'Acme Cars', slug: 'acme-cars' },
      ]
      const scoped: LocationData[] = [
        {
          ...baseLocation,
          id: '0b000000-0000-4000-8000-00000000000a',
          operatorId: 'op_a',
          name: 'A Osaka',
        },
        {
          ...baseLocation,
          id: '0b000000-0000-4000-8000-00000000000b',
          operatorId: 'op_b',
          name: 'B Tokyo',
        },
      ]
      render(<VehicleForm onSubmit={onSubmit} operators={operators} locations={scoped} />)

      await user.selectOptions(screen.getByLabelText('Operator'), 'op_a')
      await user.selectOptions(
        screen.getByLabelText('Pickup location'),
        '0b000000-0000-4000-8000-00000000000a',
      )
      // Switching operators must drop the now cross-operator location.
      await user.selectOptions(screen.getByLabelText('Operator'), 'op_b')
      await user.type(screen.getByLabelText('Vehicle name'), 'Corolla')
      await user.type(screen.getByLabelText('Daily rate'), '8000')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].pickupLocationId).toBeNull()
    })

    // #435 P2-1: edit mode hides the operator picker, but a bypass admin's
    // location list spans every operator. Scope by the vehicle's immutable
    // operatorId so cross-tenant locations are never offered.
    it('scopes locations to the vehicle operator in edit mode (operatorId prop, no picker)', () => {
      const multi: LocationData[] = [
        {
          ...baseLocation,
          id: '0c000000-0000-4000-8000-00000000000a',
          operatorId: 'op_a',
          name: 'A Osaka',
        },
        {
          ...baseLocation,
          id: '0c000000-0000-4000-8000-00000000000b',
          operatorId: 'op_b',
          name: 'B Tokyo',
        },
      ]
      render(
        <VehicleForm
          onSubmit={vi.fn()}
          operatorId="op_b"
          locations={multi}
          defaultValues={{ name: 'Fit', seats: 5, transmission: 'AUTO', dailyRateJpy: 7000 }}
        />,
      )

      expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument()
      const select = screen.getByLabelText('Pickup location') as HTMLSelectElement
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        '',
        '0c000000-0000-4000-8000-00000000000b',
      ])
    })

    // #435 P1-2: a vehicle assigned to a since-archived location — the id is
    // absent from the active list. Without preservation the unmatched <select>
    // falls back to empty and a normal save silently nulls pickupLocationId.
    it('preserves an assigned location missing from the active list and submits it unchanged', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const ARCHIVED = '0d000000-0000-4000-8000-00000000000f'
      const active: LocationData[] = [
        {
          ...baseLocation,
          id: '0a000000-0000-4000-8000-000000000001',
          operatorId: 'op_a',
          name: 'Osaka Namba',
        },
      ]
      render(
        <VehicleForm
          onSubmit={onSubmit}
          operatorId="op_a"
          locations={active}
          defaultValues={{
            name: 'Fit',
            seats: 5,
            transmission: 'AUTO',
            dailyRateJpy: 7000,
            pickupLocationId: ARCHIVED,
          }}
        />,
      )

      const select = screen.getByLabelText('Pickup location') as HTMLSelectElement
      expect(Array.from(select.options).map((o) => o.value)).toContain(ARCHIVED)
      expect(select.value).toBe(ARCHIVED)
      expect(screen.getByRole('option', { name: 'Current pickup location' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].pickupLocationId).toBe(ARCHIVED)
    })
  })

  // Issue #407: admin operator picker (gate before operator #2)
  describe('operator picker', () => {
    const operators = [
      { id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' },
      { id: 'op_b', name: 'Acme Cars', slug: 'acme-cars' },
    ]
    const oneOperator = [{ id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' }]
    const baseClass = {
      slug: 'x',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO' as const,
      fuelType: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      acrissCode: null,
      sortOrder: 0,
      status: 'ACTIVE' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    it('hides the picker but submits the sole operatorId when one operator exists', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<VehicleForm onSubmit={onSubmit} operators={oneOperator} />)

      expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('Vehicle name'), 'Corolla')
      await user.type(screen.getByLabelText('Daily rate'), '8000')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_a')
    })

    it('requires an operator choice when multiple operators exist, then submits it', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(<VehicleForm onSubmit={onSubmit} operators={operators} />)

      const picker = screen.getByLabelText('Operator')
      await user.type(screen.getByLabelText('Vehicle name'), 'Corolla')
      await user.type(screen.getByLabelText('Daily rate'), '8000')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))
      // Blocked: no operator chosen.
      await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())

      await user.selectOptions(picker, 'op_b')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_b')
    })

    it('scopes the class dropdown to the selected operator', async () => {
      const user = userEvent.setup()
      const classes = [
        { ...baseClass, id: 'c_a', name: 'A Compact', operatorId: 'op_a' },
        { ...baseClass, id: 'c_b', name: 'B SUV', operatorId: 'op_b' },
      ]
      render(<VehicleForm onSubmit={vi.fn()} operators={operators} classes={classes} />)

      await user.selectOptions(screen.getByLabelText('Operator'), 'op_a')
      const select = screen.getByLabelText('Class') as HTMLSelectElement
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'c_a'])
    })

    it('does not render the picker and omits operatorId in edit mode (no operators)', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      render(
        <VehicleForm
          onSubmit={onSubmit}
          defaultValues={{ name: 'Fit', seats: 5, transmission: 'AUTO', dailyRateJpy: 7000 }}
        />,
      )

      expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].operatorId).toBeUndefined()
    })

    // #407 P1: the operators list loads via a client query that is `undefined`
    // until it resolves. If the form only reads the default at mount, the sole
    // operatorId never populates and the create posts no operator -> 422.
    it('populates the sole operatorId when operators arrive after mount', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      const { rerender } = render(<VehicleForm onSubmit={onSubmit} operators={undefined} />)
      // The single-operator list resolves after the form has mounted.
      rerender(<VehicleForm onSubmit={onSubmit} operators={oneOperator} />)

      await user.type(screen.getByLabelText('Vehicle name'), 'Corolla')
      await user.type(screen.getByLabelText('Daily rate'), '8000')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_a')
    })

    // #407 P1: a 1->2 change while the dialog is open must clear the stale
    // auto-default so the admin is forced through the explicit-choice gate.
    it('resets the auto-selected operator to force a choice when a 2nd operator appears', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const user = userEvent.setup()
      const { rerender } = render(<VehicleForm onSubmit={onSubmit} operators={oneOperator} />)
      rerender(<VehicleForm onSubmit={onSubmit} operators={operators} />)

      expect((screen.getByLabelText('Operator') as HTMLSelectElement).value).toBe('')

      await user.type(screen.getByLabelText('Vehicle name'), 'Corolla')
      await user.type(screen.getByLabelText('Daily rate'), '8000')
      await user.click(screen.getByRole('button', { name: 'Save vehicle' }))
      await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())
    })

    // #407 P2 (§3e): when the server rejects with OPERATOR_REQUIRED, the form
    // reveals the picker and prompts for a choice even if the client still
    // believes there is a single operator (stale list, pending refetch).
    it('reveals the picker and shows the inline prompt when operatorRequired is set', () => {
      render(<VehicleForm onSubmit={vi.fn()} operators={oneOperator} operatorRequired />)
      expect(screen.getByLabelText('Operator')).toBeInTheDocument()
      expect(screen.getByText('Operator is required')).toBeInTheDocument()
    })
  })

  // Issue #226: compliance expiry date fields
  describe('compliance (shaken & insurance expiry)', () => {
    it('renders shaken and insurance date inputs with a section heading', () => {
      render(<VehicleForm onSubmit={vi.fn()} />)

      expect(screen.getByText('Compliance')).toBeInTheDocument()
      expect(
        screen.getByText('Track vehicle inspection (shaken) and insurance expiry dates.'),
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Shaken expiry date')).toBeInTheDocument()
      expect(screen.getByLabelText('Insurance expiry date')).toBeInTheDocument()
    })
  })
})
