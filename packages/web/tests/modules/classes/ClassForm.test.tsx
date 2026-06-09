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

  it('renders required fields: name, slug, seats, luggage, transmission, sortOrder (no pricing, #406)', () => {
    render(<ClassForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
    expect(screen.getByLabelText('form.slug')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.seats')).toBeInTheDocument()
    expect(screen.getByLabelText('form.luggageCapacity')).toBeInTheDocument()
    expect(screen.getByLabelText('form.luggageSize')).toBeInTheDocument()
    expect(screen.getByLabelText('form.transmission')).toBeInTheDocument()
    expect(screen.getByLabelText('form.fuelType')).toBeInTheDocument()
    expect(screen.getByLabelText('form.sortOrder')).toBeInTheDocument()
    expect(screen.getByLabelText('form.acrissCode')).toBeInTheDocument()
    // #406: class pricing dropped — no rate inputs on the form.
    expect(screen.queryByLabelText('form.dailyRate')).toBeNull()
    expect(screen.queryByLabelText('form.hourlyRate')).toBeNull()
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
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0].acrissCode == null).toBe(true)
  })

  it('submits valid data without any rate fields (#406)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.clear(screen.getByLabelText('form.seats'))
    await user.type(screen.getByLabelText('form.seats'), '5')
    await user.clear(screen.getByLabelText('form.luggageCapacity'))
    await user.type(screen.getByLabelText('form.luggageCapacity'), '2')
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
    })
    // #406: the form no longer carries rate fields.
    expect('dailyRateJpy' in data).toBe(false)
    expect('hourlyRateJpy' in data).toBe(false)
  })

  // #457: class-level default luggage size — the fallback when a vehicle leaves
  // its override blank. Required (no "none" option); defaults to MEDIUM.
  it('defaults luggageSize to MEDIUM and submits it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    expect((screen.getByLabelText('form.luggageSize') as HTMLSelectElement).value).toBe('MEDIUM')

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].luggageSize).toBe('MEDIUM')
  })

  it('submits the chosen luggageSize', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'SUV')
    await user.type(screen.getByLabelText('form.slug'), 'suv')
    await user.selectOptions(screen.getByLabelText('form.luggageSize'), 'LARGE')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].luggageSize).toBe('LARGE')
  })

  it('rejects invalid slug (uppercase, spaces)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'Compact Class')
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
          luggageSize: 'LARGE',
          transmission: 'MANUAL',
          fuelType: 'Hybrid',
          sortOrder: 5,
        }}
      />,
    )
    expect(screen.getByLabelText('form.name')).toHaveValue('Standard')
    expect(screen.getByLabelText('form.slug')).toHaveValue('standard')
    expect(screen.getByLabelText('form.description')).toHaveValue('Mid-size')
    expect(screen.getByLabelText('form.seats')).toHaveValue(7)
    expect(screen.getByLabelText('form.luggageCapacity')).toHaveValue(3)
    expect((screen.getByLabelText('form.luggageSize') as HTMLSelectElement).value).toBe('LARGE')
    expect(screen.getByLabelText('form.fuelType')).toHaveValue('Hybrid')
    expect(screen.getByLabelText('form.sortOrder')).toHaveValue(5)
  })
})

// Issue #407: admin operator picker (gate before operator #2)
describe('ClassForm — operator picker', () => {
  afterEach(() => {
    cleanup()
  })

  const operators = [
    { id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' },
    { id: 'op_b', name: 'Acme Cars', slug: 'acme-cars' },
  ]
  const oneOperator = [{ id: 'op_a', name: 'Best Car Rental', slug: 'best-car-rental' }]

  it('hides the picker but submits the sole operatorId when one operator exists', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ClassForm onSubmit={onSubmit} operators={oneOperator} />)

    expect(screen.queryByLabelText('form.operator')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_a')
  })

  it('requires an operator choice when multiple operators exist, then submits it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ClassForm onSubmit={onSubmit} operators={operators} />)

    const picker = screen.getByLabelText('form.operator')
    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())

    await user.selectOptions(picker, 'op_b')
    await user.click(screen.getByRole('button', { name: 'form.save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_b')
  })

  // #407 P1: operators load via a client query (undefined until resolved).
  it('populates the sole operatorId when operators arrive after mount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { rerender } = render(<ClassForm onSubmit={onSubmit} operators={undefined} />)
    rerender(<ClassForm onSubmit={onSubmit} operators={oneOperator} />)

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].operatorId).toBe('op_a')
  })

  // #407 P1: a 1->2 change must clear the stale auto-default (explicit-choice gate).
  it('resets the auto-selected operator to force a choice when a 2nd operator appears', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { rerender } = render(<ClassForm onSubmit={onSubmit} operators={oneOperator} />)
    rerender(<ClassForm onSubmit={onSubmit} operators={operators} />)

    expect((screen.getByLabelText('form.operator') as HTMLSelectElement).value).toBe('')

    await user.type(screen.getByLabelText('form.name'), 'Compact')
    await user.type(screen.getByLabelText('form.slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'form.save' }))
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled())
  })

  // #407 P2 (§3e): OPERATOR_REQUIRED reveals the picker + inline prompt.
  it('reveals the picker and shows the inline prompt when operatorRequired is set', () => {
    render(<ClassForm onSubmit={vi.fn()} operators={oneOperator} operatorRequired />)
    expect(screen.getByLabelText('form.operator')).toBeInTheDocument()
    expect(screen.getAllByText('form.operatorRequired').length).toBeGreaterThan(0)
  })
})

// Issue #413: edit mode validates with the update schema and never touches the
// create-only operator picker (operatorId is not patchable).
describe('ClassForm — edit mode (#413)', () => {
  afterEach(() => {
    cleanup()
  })

  const editDefaults = {
    name: 'Standard',
    slug: 'standard',
    seats: 7,
    luggageCapacity: 3,
    transmission: 'MANUAL' as const,
    sortOrder: 5,
  }

  it('never renders the operator picker in edit mode', () => {
    render(<ClassForm mode="edit" onSubmit={vi.fn()} defaultValues={editDefaults} />)
    expect(screen.queryByLabelText('form.operator')).not.toBeInTheDocument()
  })

  it('submits an edit without an operatorId (not patchable)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm mode="edit" onSubmit={onSubmit} defaultValues={editDefaults} />)

    await user.clear(screen.getByLabelText('form.seats'))
    await user.type(screen.getByLabelText('form.seats'), '8')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const data = onSubmit.mock.calls[0][0]
    expect('operatorId' in data).toBe(false)
    expect(data).toMatchObject({ name: 'Standard', slug: 'standard', seats: 8 })
  })

  it('still rejects an invalid slug in edit mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ClassForm mode="edit" onSubmit={onSubmit} defaultValues={editDefaults} />)

    const slug = screen.getByLabelText('form.slug')
    await user.clear(slug)
    await user.type(slug, 'Not A Slug')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
