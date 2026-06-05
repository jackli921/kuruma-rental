// #407 P2 (§3e): when a create is rejected with OPERATOR_REQUIRED (a second
// operator now exists), the dialog must refetch operators, reveal the picker,
// and suppress the raw 422 message — not surface it as a generic dialog error.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      addVehicle: 'Add vehicle',
      subtitle: 'Add a vehicle to your fleet',
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
      'form.rentalRulesHint': 'Optional limits.',
      'form.minRentalHours': 'Minimum rental (hours)',
      'form.maxRentalHours': 'Maximum rental (hours)',
      'form.advanceBookingHours': 'Advance booking (hours)',
      'form.complianceHeading': 'Compliance',
      'form.complianceHint': 'Track expiry dates.',
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
    }
    return messages[key] ?? key
  },
}))

const createVehicleAction = vi.fn()
vi.mock('@/lib/vehicle-actions', () => ({
  createVehicleAction: (...args: unknown[]) => createVehicleAction(...args),
}))

// The operators barrel re-exports a `'use server'` action whose import chain
// (api-token -> auth -> next-auth) can't resolve under vitest. Stub it so the
// barrel (operatorKeys) loads; the dialog never calls the action directly.
vi.mock('@/modules/operators/actions', () => ({ fetchOperatorsAction: vi.fn() }))

import { AddVehicleDialog } from '@/components/vehicles/AddVehicleDialog'
import type { OperatorOption } from '@/modules/operators'

const SINGLE_OPERATOR: OperatorOption[] = [{ id: 'op_a', name: 'Best Car Rental', slug: 'bcr' }]

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <AddVehicleDialog open onOpenChange={vi.fn()} classes={[]} operators={SINGLE_OPERATOR} />
    </QueryClientProvider>,
  )
  return { invalidateSpy }
}

describe('AddVehicleDialog — OPERATOR_REQUIRED recovery', () => {
  afterEach(() => {
    cleanup()
    createVehicleAction.mockReset()
  })

  it('reveals the picker, refetches operators, and suppresses the raw 422 message', async () => {
    createVehicleAction.mockResolvedValue({
      success: false,
      error: 'operatorId is required',
      code: 'OPERATOR_REQUIRED',
    })
    const user = userEvent.setup()
    const { invalidateSpy } = renderDialog()

    // Single operator: no visible picker yet.
    expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Vehicle name'), 'Toyota Corolla')
    await user.type(screen.getByLabelText('Daily rate'), '8000')
    await user.click(screen.getByText('Save vehicle'))

    // Picker revealed after the server says a second operator now exists.
    expect(await screen.findByLabelText('Operator')).toBeInTheDocument()
    // Operators query invalidated so the now-stale single-operator list refetches.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['operators'] })
    // The inline picker prompt replaces the raw 422 message.
    expect(screen.getAllByText('Operator is required').length).toBeGreaterThan(0)
    expect(screen.queryByText('operatorId is required')).not.toBeInTheDocument()
  })
})
