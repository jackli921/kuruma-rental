import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { AddOnForm } from '@/vite/operator-add-ons/AddOnForm'

describe('AddOnForm', () => {
  afterEach(() => cleanup())

  it('renders the name, description and price fields', () => {
    render(<AddOnForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.price')).toBeInTheDocument()
  })

  it('submits valid data with priceJpy as a number (proves valueAsNumber coercion)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AddOnForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Child seat')
    await user.clear(screen.getByLabelText('form.price'))
    await user.type(screen.getByLabelText('form.price'), '1500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const data = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'Child seat', priceJpy: 1500 })
    // Mutation-resistant: a string '1500' would pass toMatchObject loosely, so
    // assert the runtime type — this is what valueAsNumber guarantees.
    expect(typeof data.priceJpy).toBe('number')
  })

  it('blocks submit and surfaces the error when the name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AddOnForm onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.price'))
    await user.type(screen.getByLabelText('form.price'), '1500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(screen.getByText('Name is required')).toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks submit for a negative price', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<AddOnForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Child seat')
    await user.clear(screen.getByLabelText('form.price'))
    await user.type(screen.getByLabelText('form.price'), '-1')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(screen.getByText('Price cannot be negative')).toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pre-fills defaults in edit mode', () => {
    render(
      <AddOnForm
        onSubmit={vi.fn()}
        defaultValues={{ name: 'ETC card', description: 'Toll pass', priceJpy: 500 }}
      />,
    )
    expect(screen.getByLabelText('form.name')).toHaveValue('ETC card')
    expect(screen.getByLabelText('form.description')).toHaveValue('Toll pass')
    expect(screen.getByLabelText('form.price')).toHaveValue(500)
  })
})
