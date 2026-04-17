import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { ClassForm } from '@/modules/classes/components/ClassForm'

describe('ClassForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders required fields: name, slug, seats, luggage, transmission, pricing, sortOrder', () => {
    render(<ClassForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
    expect(screen.getByLabelText('form.slug')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.seats')).toBeInTheDocument()
    expect(screen.getByLabelText('form.luggageCapacity')).toBeInTheDocument()
    expect(screen.getByLabelText('form.transmission')).toBeInTheDocument()
    expect(screen.getByLabelText('form.fuelType')).toBeInTheDocument()
    expect(screen.getByLabelText('form.dailyRate')).toBeInTheDocument()
    expect(screen.getByLabelText('form.hourlyRate')).toBeInTheDocument()
    expect(screen.getByLabelText('form.sortOrder')).toBeInTheDocument()
  })

  it('submits valid data with daily rate only', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.clear(screen.getByLabelText('form.seats'))
    await user.type(screen.getByLabelText('form.seats'), '5')
    await user.clear(screen.getByLabelText('form.luggageCapacity'))
    await user.type(screen.getByLabelText('form.luggageCapacity'), '2')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const data = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({
      name: 'Compact',
      slug: 'compact',
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      dailyRateJpy: 8000,
    })
    // hourly rate left blank should submit as null, not 0 or NaN
    expect(data.hourlyRateJpy == null).toBe(true)
  })

  it('blocks submit when both rates are empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('rejects invalid slug (uppercase, spaces)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'Compact Class')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it('pre-fills defaults in edit mode', () => {
    render(
      <ClassForm
        onSubmit={vi.fn()}
        defaultValues={{
          name: 'Standard',
          slug: 'standard',
          description: 'Mid-size',
          seats: 7,
          luggageCapacity: 3,
          transmission: 'MANUAL',
          fuelType: 'Hybrid',
          dailyRateJpy: 10000,
          hourlyRateJpy: 1500,
          sortOrder: 5,
        }}
      />,
    )
    expect(screen.getByLabelText('form.name')).toHaveValue('Standard')
    expect(screen.getByLabelText('form.slug')).toHaveValue('standard')
    expect(screen.getByLabelText('form.description')).toHaveValue('Mid-size')
    expect(screen.getByLabelText('form.seats')).toHaveValue(7)
    expect(screen.getByLabelText('form.luggageCapacity')).toHaveValue(3)
    expect(screen.getByLabelText('form.fuelType')).toHaveValue('Hybrid')
    expect(screen.getByLabelText('form.dailyRate')).toHaveValue(10000)
    expect(screen.getByLabelText('form.hourlyRate')).toHaveValue(1500)
    expect(screen.getByLabelText('form.sortOrder')).toHaveValue(5)
  })
})
