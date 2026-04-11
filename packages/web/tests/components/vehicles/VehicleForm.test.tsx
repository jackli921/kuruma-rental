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
      'form.save': 'Save vehicle',
      'form.saving': 'Saving...',
      'form.cancel': 'Cancel',
    }
    return messages[key] ?? key
  },
}))

import { VehicleForm } from '@/components/vehicles/VehicleForm'

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
})
