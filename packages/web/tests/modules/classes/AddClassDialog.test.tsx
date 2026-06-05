// #407 P2 (§3e): AddClassDialog mirrors AddVehicleDialog — on an
// OPERATOR_REQUIRED 422 it refetches operators, reveals the picker, and
// suppresses the raw 422 message.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      addClass: 'Add class',
      addSubtitle: 'Add a vehicle class',
      'form.name': 'Class name',
      'form.namePlaceholder': 'e.g. Compact',
      'form.slug': 'Slug',
      'form.slugPlaceholder': 'compact',
      'form.slugHint': 'URL-friendly identifier',
      'form.description': 'Description',
      'form.descriptionPlaceholder': 'Brief description',
      'form.seats': 'Seats',
      'form.luggageCapacity': 'Luggage capacity',
      'form.transmission': 'Transmission',
      'form.transmissionAuto': 'Automatic',
      'form.transmissionManual': 'Manual',
      'form.fuelType': 'Fuel type',
      'form.fuelTypePlaceholder': 'e.g. Gasoline',
      'form.acrissCode': 'ACRISS code',
      'form.acrissCodeNone': 'None',
      'form.pricingHeading': 'Pricing (JPY)',
      'form.pricingHint': 'At least one rate is required.',
      'form.dailyRate': 'Daily rate',
      'form.hourlyRate': 'Hourly rate',
      'form.sortOrder': 'Sort order',
      'form.sortOrderHint': 'Lower sorts first',
      'form.save': 'Save class',
      'form.saving': 'Saving...',
      'form.cancel': 'Cancel',
      'form.operator': 'Operator',
      'form.operatorPlaceholder': 'Select an operator',
      'form.operatorRequired': 'Operator is required',
    }
    return messages[key] ?? key
  },
}))

const createClassAction = vi.fn()
vi.mock('@/modules/classes/actions', () => ({
  createClassAction: (...args: unknown[]) => createClassAction(...args),
}))

// The operators barrel re-exports a `'use server'` action whose import chain
// (api-token -> auth -> next-auth) can't resolve under vitest. Stub it so the
// barrel (operatorKeys) loads; the dialog never calls the action directly.
vi.mock('@/modules/operators/actions', () => ({ fetchOperatorsAction: vi.fn() }))

import { AddClassDialog } from '@/modules/classes/components/AddClassDialog'
import type { OperatorOption } from '@/modules/operators'

const SINGLE_OPERATOR: OperatorOption[] = [{ id: 'op_a', name: 'Best Car Rental', slug: 'bcr' }]

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <AddClassDialog open onOpenChange={vi.fn()} operators={SINGLE_OPERATOR} />
    </QueryClientProvider>,
  )
  return { invalidateSpy }
}

describe('AddClassDialog — OPERATOR_REQUIRED recovery', () => {
  afterEach(() => {
    cleanup()
    createClassAction.mockReset()
  })

  it('reveals the picker, refetches operators, and suppresses the raw 422 message', async () => {
    createClassAction.mockResolvedValue({
      success: false,
      error: 'operatorId is required',
      code: 'OPERATOR_REQUIRED',
    })
    const user = userEvent.setup()
    const { invalidateSpy } = renderDialog()

    expect(screen.queryByLabelText('Operator')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Class name'), 'Compact')
    await user.type(screen.getByLabelText('Slug'), 'compact')
    await user.type(screen.getByLabelText('Daily rate'), '8000')
    await user.click(screen.getByText('Save class'))

    expect(await screen.findByLabelText('Operator')).toBeInTheDocument()
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['operators'] })
    expect(screen.getAllByText('Operator is required').length).toBeGreaterThan(0)
    expect(screen.queryByText('operatorId is required')).not.toBeInTheDocument()
  })
})
