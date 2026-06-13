import { ClassForm } from '@/vite/operator-classes/ClassForm'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

function renderForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <IntlProvider locale="en" messages={en}>
      <ClassForm onSubmit={onSubmit} />
    </IntlProvider>,
  )
  return onSubmit
}

describe('ClassForm (create)', () => {
  it('submits schema-parsed values (defaults applied) for a valid class', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Class name'), 'Compact')
    await user.type(screen.getByLabelText('Slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'Save class' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Compact',
        slug: 'compact',
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO',
        sortOrder: 0,
        photos: [],
        luggageSize: 'MEDIUM',
        acrissCode: null,
      }),
    )
  })

  it('submits the chosen luggage size (overriding the MEDIUM default)', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Class name'), 'Large Van')
    await user.type(screen.getByLabelText('Slug'), 'large-van')
    await user.selectOptions(screen.getByLabelText('Luggage size'), 'LARGE')
    await user.click(screen.getByRole('button', { name: 'Save class' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ luggageSize: 'LARGE' }))
  })

  it('blocks submit and shows an error when the name is empty', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Slug'), 'compact')
    await user.click(screen.getByRole('button', { name: 'Save class' }))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects an invalid (non-kebab) slug', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Class name'), 'Compact')
    await user.type(screen.getByLabelText('Slug'), 'Bad Slug')
    await user.click(screen.getByRole('button', { name: 'Save class' }))

    expect(
      await screen.findByText('Slug must be lowercase alphanumeric with hyphens'),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
