import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { InsuranceForm } from '@/modules/insurance/components/InsuranceForm'

describe('InsuranceForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the name, description and daily-price fields', () => {
    render(<InsuranceForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.name')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.dailyPrice')).toBeInTheDocument()
  })

  it('submits valid data with daily price and no deductible (full cover)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Standard Cover')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '1500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const data = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'Standard Cover', dailyPriceJpy: 1500 })
    // deductible left off should submit as null, not 0 or NaN
    expect(data.deductibleJpy == null).toBe(true)
  })

  it('surfaces a validation error and blocks submit when the name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '1500')
    // name left blank
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('surfaces a validation error and blocks submit for a negative daily price', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Standard Cover')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '-1')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(screen.getByText('Daily price cannot be negative')).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks submit for a negative deductible once the deductible field is enabled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Premium Cover')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '2500')
    await user.click(screen.getByLabelText('form.setDeductible'))
    await user.clear(screen.getByLabelText('form.deductible'))
    await user.type(screen.getByLabelText('form.deductible'), '-1')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(screen.getByText('Deductible cannot be negative')).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pre-fills defaults in edit mode (including a deductible)', () => {
    render(
      <InsuranceForm
        onSubmit={vi.fn()}
        defaultValues={{
          name: 'Premium Cover',
          description: 'High protection',
          dailyPriceJpy: 2500,
          deductibleJpy: 250000,
        }}
      />,
    )
    expect(screen.getByLabelText('form.name')).toHaveValue('Premium Cover')
    expect(screen.getByLabelText('form.description')).toHaveValue('High protection')
    expect(screen.getByLabelText('form.dailyPrice')).toHaveValue(2500)
    expect(screen.getByLabelText('form.deductible')).toHaveValue(250000)
  })
})
