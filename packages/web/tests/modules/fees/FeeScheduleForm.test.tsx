import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { FeeScheduleForm } from '@/modules/fees/components/FeeScheduleForm'

const noClasses: never[] = []

describe('FeeScheduleForm — unit is constrained by fee type', () => {
  afterEach(() => {
    cleanup()
  })

  it('defaults to CLEANING_FLAT and shows the FLAT unit (read-only)', () => {
    render(<FeeScheduleForm onSubmit={vi.fn()} classes={noClasses} />)
    // The unit field is read-only and shows the localized FLAT label.
    expect(screen.getByLabelText('form.unit')).toHaveValue('unit.FLAT')
    expect(screen.getByLabelText('form.unit')).toHaveAttribute('readonly')
  })

  it('switches the unit to PER_HOUR when the fee type becomes OVERTIME_HOURLY', async () => {
    const user = userEvent.setup()
    render(<FeeScheduleForm onSubmit={vi.fn()} classes={noClasses} />)

    await user.click(screen.getByLabelText('form.feeType'))
    await user.click(screen.getByRole('option', { name: 'type.OVERTIME_HOURLY' }))

    await waitFor(() => {
      expect(screen.getByLabelText('form.unit')).toHaveValue('unit.PER_HOUR')
    })
  })

  it('submits the coherent (feeType, unit) pair the type dictates', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<FeeScheduleForm onSubmit={onSubmit} classes={noClasses} />)

    await user.click(screen.getByLabelText('form.feeType'))
    await user.click(screen.getByRole('option', { name: 'type.OVERTIME_HOURLY' }))
    await user.type(screen.getByLabelText('form.amount'), '500')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      feeType: 'OVERTIME_HOURLY',
      unit: 'PER_HOUR',
      amountJpy: 500,
      vehicleClassId: null,
    })
  })

  it('pre-fills the unit from defaults in edit mode', () => {
    render(
      <FeeScheduleForm
        onSubmit={vi.fn()}
        classes={noClasses}
        defaultValues={{ feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 800 }}
      />,
    )
    expect(screen.getByLabelText('form.unit')).toHaveValue('unit.PER_HOUR')
    expect(screen.getByLabelText('form.amount')).toHaveValue(800)
  })
})
