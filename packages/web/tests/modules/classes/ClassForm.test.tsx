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
    expect(screen.getByLabelText('form.acrissCode')).toBeInTheDocument()
  })

  it('offers the 8 ACRISS codes plus a "none" option in the select', () => {
    render(<ClassForm onSubmit={vi.fn()} />)
    const select = screen.getByLabelText('form.acrissCode') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    // empty value (None) first, then the 8 dictionary codes
    expect(values).toEqual(['', 'MCAR', 'ECAR', 'CCAR', 'ICAR', 'SCAR', 'FCAR', 'IVAR', 'SUVR'])
  })

  it('submits the chosen acrissCode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    await user.selectOptions(screen.getByLabelText('form.acrissCode'), 'CCAR')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0].acrissCode).toBe('CCAR')
  })

  it('submits null acrissCode when "none" is left selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0].acrissCode == null).toBe(true)
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

  // MEDIUM 4 regression: an empty-string description from an untouched
  // Textarea must not reach the API as `description: ""` — the server would
  // store an empty value instead of treating it as "no description". The
  // form coerces empty/whitespace-only descriptions to undefined on submit.
  it('omits description when the field is left empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    // description left blank
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const data = onSubmit.mock.calls[0][0]
    expect(data.description).toBeUndefined()
  })

  it('omits description when the field contains only whitespace', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.type(screen.getByLabelText('form.description'), '   ')
    await user.type(screen.getByLabelText('form.dailyRate'), '8000')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const data = onSubmit.mock.calls[0][0]
    expect(data.description).toBeUndefined()
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
