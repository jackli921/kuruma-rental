import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { InsuranceForm } from '@/vite/operator-insurance/InsuranceForm'

// #1437 slice 3: insurance is purely self-authored — the form holds three flat
// name slots (en/ja/zh) and hands the caller InsuranceFormValues; the dialog
// collapses them into a nameI18n bundle before the wire.
describe('InsuranceForm', () => {
  afterEach(() => cleanup())

  it('renders the en/ja/zh name slots, description and daily-price fields', () => {
    render(<InsuranceForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.nameEn')).toBeInTheDocument()
    expect(screen.getByLabelText('form.nameJa')).toBeInTheDocument()
    expect(screen.getByLabelText('form.nameZh')).toBeInTheDocument()
    expect(screen.getByLabelText('form.description')).toBeInTheDocument()
    expect(screen.getByLabelText('form.dailyPrice')).toBeInTheDocument()
  })

  it('submits the flat name slots with daily price and no deductible (full cover → null)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.nameEn'), 'Standard Cover')
    await user.type(screen.getByLabelText('form.nameJa'), '標準補償')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '1500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const data = onSubmit.mock.calls[0][0]
    expect(data).toMatchObject({
      nameEn: 'Standard Cover',
      nameJa: '標準補償',
      nameZh: '',
      dailyPriceJpy: 1500,
    })
    expect(data.deductibleJpy == null).toBe(true)
  })

  it('blocks submit and surfaces the error when the English name is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InsuranceForm onSubmit={onSubmit} />)

    // Author only ja — en is the required floor, so submit must be blocked.
    await user.type(screen.getByLabelText('form.nameJa'), '標準補償')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '1500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(screen.getByText('Enter an English name')).toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks submit for a negative daily price', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.nameEn'), 'Standard Cover')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '-1')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() =>
      expect(screen.getByText('Daily price cannot be negative')).toBeInTheDocument(),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks submit for a negative deductible once the deductible field is enabled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InsuranceForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.nameEn'), 'Premium Cover')
    await user.clear(screen.getByLabelText('form.dailyPrice'))
    await user.type(screen.getByLabelText('form.dailyPrice'), '2500')
    await user.click(screen.getByLabelText('form.setDeductible'))
    await user.clear(screen.getByLabelText('form.deductible'))
    await user.type(screen.getByLabelText('form.deductible'), '-1')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() =>
      expect(screen.getByText('Deductible cannot be negative')).toBeInTheDocument(),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pre-fills the name slots in edit mode (including a deductible)', () => {
    render(
      <InsuranceForm
        onSubmit={vi.fn()}
        defaultValues={{
          nameEn: 'Premium Cover',
          nameJa: 'プレミアム',
          nameZh: '高级',
          description: 'High protection',
          dailyPriceJpy: 2500,
          deductibleJpy: 250000,
        }}
      />,
    )
    expect(screen.getByLabelText('form.nameEn')).toHaveValue('Premium Cover')
    expect(screen.getByLabelText('form.nameJa')).toHaveValue('プレミアム')
    expect(screen.getByLabelText('form.nameZh')).toHaveValue('高级')
    expect(screen.getByLabelText('form.description')).toHaveValue('High protection')
    expect(screen.getByLabelText('form.dailyPrice')).toHaveValue(2500)
    expect(screen.getByLabelText('form.deductible')).toHaveValue(250000)
  })
})
